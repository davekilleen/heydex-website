import {
  CAREER_LEVEL_OPTIONS,
  COACHING_STYLE_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  DEFAULT_PROFILE,
  DETAIL_LEVEL_OPTIONS,
  DIRECTNESS_OPTIONS,
  FORMALITY_OPTIONS,
  MONTH_OPTIONS,
  ROLE_GROUP_OPTIONS,
  WHAT_STAYS_LOCAL,
  WHAT_SYNCS,
  applyMeetingPreset,
  buildDeviceFacts,
  buildSummaryChips,
  cloneProfile,
  derivePageState,
  detectMeetingPreset,
  formatRelativeTime,
  getActiveDevices,
  mostRecentDevice,
  normalizeProfile,
  syncModeForHarness,
} from "./logic.mjs";

const page = document.body.dataset.page || "settings";
const config = Object.assign(
  {
    apiBaseUrl: window.location.origin,
    clerkPublishableKey: "",
    installUrl: "https://github.com/davekilleen/dex",
    docsUrl: "https://github.com/davekilleen/dex",
  },
  window.DEX_SETTINGS_CONFIG || {},
);
const apiBaseUrl = String(config.apiBaseUrl || window.location.origin).replace(/\/$/, "");

const state = {
  clerk: null,
  authState: "loading",
  signedIn: false,
  user: null,
  profile: cloneProfile(DEFAULT_PROFILE),
  devices: [],
  profileVersion: 0,
  profileUpdatedAt: "",
  loadError: "",
  saveStatus: "idle",
  saveError: "",
  saveTimer: null,
  saveInFlight: false,
  pendingResave: false,
  isHydrating: false,
  userButtonMounted: false,
  linkCode: new URL(window.location.href).searchParams.get("code") || "",
  linkStatus: "loading",
  linkInfo: null,
  linkError: "",
  approveInFlight: false,
};

const flowStepsByState = {
  linked: [
    {
      title: "Edit your roaming profile here",
      body: "Changes save to Dex Cloud and stay narrowly scoped to the Phase 1 profile.",
    },
    {
      title: "Claude Code can apply it automatically",
      body: "Linked Claude Code devices can pull on session start. Cursor stays manual in Phase 1.",
    },
    {
      title: "Secrets still stay local",
      body: "API keys, providers, MCP setup, hooks, vault paths, and UI state are still machine-local.",
    },
  ],
  web_first: [
    {
      title: "Set your profile up first",
      body: "That makes Dex feel more personal the first time it runs.",
    },
    {
      title: "Install Dex",
      body: "Download Dex when you are ready to use it on a machine.",
    },
    {
      title: "Run `./dex login` once",
      body: "Dex links the machine and pulls this saved profile down automatically.",
    },
  ],
  existing_user: [
    {
      title: "Open this page while signed in",
      body: "You can review the web profile before connecting a machine.",
    },
    {
      title: "Run `./dex login` inside your Dex folder",
      body: "Dex opens the browser, connects the machine, and checks whether local and web profiles match.",
    },
    {
      title: "Choose the source if needed",
      body: "If local and web profiles differ, Dex asks which one should win first. No silent merge.",
    },
  ],
};

function settingsRefs() {
  return {
    appShell: document.getElementById("appShell"),
    configGate: document.getElementById("configGate"),
    authGate: document.getElementById("authGate"),
    authStatusMessage: document.getElementById("authStatusMessage"),
    authAction: document.getElementById("authAction"),
    signInGateButton: document.getElementById("signInGateButton"),
    userButton: document.getElementById("userButton"),
    refreshData: document.getElementById("refreshData"),
    bannerTitle: document.getElementById("bannerTitle"),
    bannerBody: document.getElementById("bannerBody"),
    bannerPrimaryAction: document.getElementById("bannerPrimaryAction"),
    bannerSecondaryAction: document.getElementById("bannerSecondaryAction"),
    saveStatusInline: document.getElementById("saveStatusInline"),
    saveStatusBlock: document.getElementById("saveStatusBlock"),
    syncChip: document.getElementById("syncChip"),
    syncNote: document.getElementById("syncNote"),
    devicesList: document.getElementById("devicesList"),
    deviceFacts: document.getElementById("deviceFacts"),
    syncScopeList: document.getElementById("syncScopeList"),
    localOnlyList: document.getElementById("localOnlyList"),
    flowSteps: document.getElementById("flowSteps"),
    copyLoginInline: document.getElementById("copyLoginInline"),
    navItems: [...document.querySelectorAll("[data-nav-target]")],
    panels: [...document.querySelectorAll("[data-settings-panel]")],
    pathInputs: [...document.querySelectorAll("[data-path]")],
    chipGroups: [...document.querySelectorAll("[data-chip-group]")],
    presetButtons: [...document.querySelectorAll("[data-meeting-preset]")],
    meetingAdvanced: document.getElementById("meetingAdvanced"),
  };
}

function linkRefs() {
  return {
    configGate: document.getElementById("configGate"),
    authGate: document.getElementById("authGate"),
    authStatusMessage: document.getElementById("authStatusMessage"),
    authAction: document.getElementById("authAction"),
    signInGateButton: document.getElementById("signInGateButton"),
    userButton: document.getElementById("userButton"),
    linkStatusChip: document.getElementById("linkStatusChip"),
    linkTitle: document.getElementById("linkTitle"),
    linkBody: document.getElementById("linkBody"),
    linkFacts: document.getElementById("linkFacts"),
    approveButton: document.getElementById("approveButton"),
    linkError: document.getElementById("linkError"),
    backToSettingsLink: document.getElementById("backToSettingsLink"),
  };
}

function getRefs() {
  return page === "settings" ? settingsRefs() : linkRefs();
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let current = target;
  while (parts.length > 1) {
    const key = parts.shift();
    current = current[key];
  }
  current[parts[0]] = value;
}

function getPath(target, path) {
  return path.split(".").reduce((current, key) => current?.[key], target);
}

function optionMarkup(select, options) {
  if (!select) {
    return;
  }
  select.innerHTML = "";
  for (const option of options) {
    const element = document.createElement("option");
    element.value = String(option.value);
    element.textContent = option.label;
    select.appendChild(element);
  }
}

function renderStaticLists(refs) {
  if (!refs.syncScopeList || !refs.localOnlyList) {
    return;
  }

  refs.syncScopeList.innerHTML = "";
  WHAT_SYNCS.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    refs.syncScopeList.appendChild(li);
  });

  refs.localOnlyList.innerHTML = "";
  WHAT_STAYS_LOCAL.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    refs.localOnlyList.appendChild(li);
  });
}

function populateSelects(refs) {
  if (page !== "settings") {
    return;
  }

  optionMarkup(document.getElementById("profile-role-group"), ROLE_GROUP_OPTIONS);
  optionMarkup(document.getElementById("profile-company-size"), COMPANY_SIZE_OPTIONS);
  optionMarkup(document.getElementById("profile-formality"), FORMALITY_OPTIONS);
  optionMarkup(document.getElementById("profile-directness"), DIRECTNESS_OPTIONS);
  optionMarkup(document.getElementById("profile-detail-level"), DETAIL_LEVEL_OPTIONS);
  optionMarkup(document.getElementById("profile-coaching-style"), COACHING_STYLE_OPTIONS);
  optionMarkup(document.getElementById("profile-career-level"), CAREER_LEVEL_OPTIONS);
  optionMarkup(document.getElementById("profile-quarterly-month"), MONTH_OPTIONS);
}

function openInstallUrl() {
  window.open(config.installUrl, "_blank", "noopener,noreferrer");
}

async function copyText(value, successMessage = "Copied.") {
  try {
    await navigator.clipboard.writeText(value);
    setTransientSaveStatus(successMessage);
  } catch (_error) {
    window.prompt("Copy this text:", value);
  }
}

function setTransientSaveStatus(message) {
  if (page !== "settings") {
    return;
  }
  const refs = getRefs();
  refs.saveStatusInline.textContent = message;
  window.clearTimeout(state.saveStatusToastTimer);
  state.saveStatusToastTimer = window.setTimeout(() => {
    renderSettings();
  }, 2000);
}

function formatSaveStatus() {
  if (state.saveStatus === "saving") {
    return "Saving changes…";
  }
  if (state.saveStatus === "error") {
    return state.saveError || "Save failed.";
  }
  if (state.profileUpdatedAt) {
    return `Saved ${formatRelativeTime(state.profileUpdatedAt)}.`;
  }
  if (state.signedIn) {
    return "Changes save automatically.";
  }
  return "Sign in to load and save your profile.";
}

async function waitForClerkGlobal() {
  const start = Date.now();
  while (!window.Clerk && Date.now() - start < 10000) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return window.Clerk || null;
}

async function initAuth() {
  if (!config.clerkPublishableKey) {
    state.authState = "missing_config";
    renderPage();
    return;
  }

  const clerkGlobal = await waitForClerkGlobal();
  if (!clerkGlobal) {
    state.authState = "error";
    state.loadError = "Clerk script did not load.";
    renderPage();
    return;
  }

  try {
    if (!clerkGlobal.loaded) {
      await clerkGlobal.load({ publishableKey: config.clerkPublishableKey });
    }
    state.clerk = clerkGlobal;
    state.user = clerkGlobal.user || null;
    state.signedIn = Boolean(clerkGlobal.session && clerkGlobal.user);
    state.authState = state.signedIn ? "signed_in" : "signed_out";
    renderPage();

    if (state.signedIn && page === "settings") {
      await refreshSettingsData();
    }
    if (state.signedIn && page === "link-device" && state.linkStatus !== "loading") {
      renderPage();
    }
  } catch (error) {
    state.authState = "error";
    state.loadError = error instanceof Error ? error.message : "Could not load Clerk.";
    renderPage();
  }
}

async function getSessionToken() {
  const token = await state.clerk?.session?.getToken();
  if (!token) {
    throw new Error("Your sign-in session is missing a browser token.");
  }
  return token;
}

async function apiFetch(path, { method = "GET", body, authenticated = true } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (authenticated) {
    headers.Authorization = `Bearer ${await getSessionToken()}`;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_error) {
      payload = { detail: text };
    }
  }

  if (!response.ok) {
    throw new Error(payload.detail || `Request failed (${response.status})`);
  }

  return payload;
}

function syncChipClass(kind) {
  return `status-chip ${kind}`;
}

function setButtonTooltip(button, message) {
  if (!button) {
    return;
  }

  if (!message) {
    button.removeAttribute("data-tooltip");
    button.removeAttribute("title");
    button.classList.remove("has-tooltip");
    return;
  }

  button.dataset.tooltip = message;
  button.title = message;
  button.classList.add("has-tooltip");
}

function mountUserButton(refs) {
  if (!state.signedIn || !state.clerk?.mountUserButton || !refs.userButton) {
    return;
  }
  refs.userButton.innerHTML = "";
  state.clerk.mountUserButton(refs.userButton);
  state.userButtonMounted = true;
}

function renderAuthChrome(refs) {
  if (refs.configGate) {
    refs.configGate.classList.toggle("hidden", state.authState !== "missing_config");
  }
  if (refs.authGate) {
    refs.authGate.classList.toggle(
      "hidden",
      !["signed_out", "error"].includes(state.authState),
    );
  }

  const signedOutMessage = page === "settings"
    ? "Sign in to load your Dex profile and linked devices."
    : "Sign in to approve this Dex device.";

  if (refs.authStatusMessage) {
    if (state.authState === "missing_config") {
      refs.authStatusMessage.textContent = "Clerk key missing in /settings/config.js.";
    } else if (state.authState === "loading") {
      refs.authStatusMessage.textContent = "Checking sign-in…";
    } else if (state.authState === "error") {
      refs.authStatusMessage.textContent = state.loadError || "Could not load sign-in.";
    } else if (state.authState === "signed_in") {
      refs.authStatusMessage.textContent = `Signed in as ${state.user?.primaryEmailAddress?.emailAddress || state.user?.username || "your account"}.`;
    } else {
      refs.authStatusMessage.textContent = signedOutMessage;
    }
  }

  if (refs.authAction) {
    const shouldShow = ["signed_out", "error"].includes(state.authState);
    refs.authAction.classList.toggle("hidden", !shouldShow);
    refs.authAction.textContent = "Sign in";
    refs.authAction.onclick = openSignIn;
  }

  if (refs.signInGateButton) {
    refs.signInGateButton.onclick = openSignIn;
  }

  if (refs.userButton) {
    if (state.authState !== "signed_in") {
      refs.userButton.innerHTML = "";
      state.userButtonMounted = false;
    } else if (!state.userButtonMounted) {
      mountUserButton(refs);
    }
  }
}

function syncFormDisabled(disabled) {
  if (page !== "settings") {
    return;
  }
  const refs = getRefs();
  refs.pathInputs.forEach((input) => {
    input.disabled = disabled;
  });
  refs.presetButtons.forEach((button) => {
    button.disabled = disabled;
  });
  refs.chipGroups.forEach((group) => {
    [...group.querySelectorAll(".chip")].forEach((button) => {
      button.disabled = disabled;
    });
  });
}

function setActiveNavItem(refs, sectionId) {
  if (!refs.navItems?.length) {
    return;
  }

  refs.navItems.forEach((item) => {
    item.classList.toggle("is-active", item.dataset.navTarget === sectionId);
  });
}

function activateSettingsPanel(sectionId, updateHistory = false) {
  if (page !== "settings") {
    return;
  }

  const refs = getRefs();
  const targetId = refs.panels.some((panel) => panel.id === sectionId)
    ? sectionId
    : refs.panels[0]?.id;

  if (!targetId) {
    return;
  }

  state.activeSettingsPanel = targetId;
  setActiveNavItem(refs, targetId);
  refs.panels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== targetId);
  });

  if (updateHistory) {
    window.history.replaceState(null, "", `#${targetId}`);
  }
}

function renderChipGroups(refs) {
  refs.chipGroups.forEach((group) => {
    const path = group.dataset.chipGroup;
    const currentValue = getPath(state.profile, path);
    [...group.querySelectorAll(".chip")].forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.value === currentValue);
    });
  });
}

function syncFormValues(refs) {
  state.isHydrating = true;
  refs.pathInputs.forEach((input) => {
    const path = input.dataset.path;
    const rawValue = getPath(state.profile, path);
    if (input.type === "checkbox") {
      input.checked = Boolean(rawValue);
      return;
    }
    if (path === "quarterly_planning.enabled") {
      input.value = rawValue ? "true" : "false";
      return;
    }
    input.value = rawValue == null ? "" : String(rawValue);
  });
  renderChipGroups(refs);
  if (refs.presetButtons.length) {
    const preset = detectMeetingPreset(state.profile);
    refs.presetButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.meetingPreset === preset);
    });
    if (refs.meetingAdvanced) {
      refs.meetingAdvanced.open = preset === "custom";
    }
  }
  state.isHydrating = false;
}

function renderFlowSteps(refs) {
  refs.flowSteps.innerHTML = "";
  const steps = flowStepsByState[state.pageState] || flowStepsByState.existing_user;
  steps.forEach((step, index) => {
    const item = document.createElement("div");
    item.className = "step";

    const number = document.createElement("div");
    number.className = "step-num";
    number.textContent = String(index + 1);

    const body = document.createElement("div");
    body.className = "step-body";

    const title = document.createElement("strong");
    title.textContent = step.title.replace(/`/g, "");

    const description = document.createElement("span");
    description.textContent = step.body.replace(/`/g, "");

    body.appendChild(title);
    body.appendChild(description);
    item.appendChild(number);
    item.appendChild(body);
    refs.flowSteps.appendChild(item);
  });
}

function renderDeviceFacts(refs) {
  refs.deviceFacts.innerHTML = "";
  buildDeviceFacts(state.devices).forEach((fact) => {
    const li = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = `${fact.label}: `;
    li.appendChild(strong);
    li.appendChild(document.createTextNode(fact.value.replace(/`/g, "")));
    refs.deviceFacts.appendChild(li);
  });
}

function renderDevices(refs) {
  refs.devicesList.innerHTML = "";
  if (state.devices.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No Dex device is linked yet. You can still save this profile first, then run ./dex login on a Dex machine.";
    refs.devicesList.appendChild(empty);
    return;
  }

  state.devices.forEach((device) => {
    const item = document.createElement("div");
    item.className = "device-item";

    const meta = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = device.device_name || "Unnamed device";

    const detail = document.createElement("span");
    const statusBits = [
      device.harness === "claude_code" ? "Claude Code" : device.harness === "cursor" ? "Cursor" : device.harness,
      device.platform,
      syncModeForHarness(device.harness),
      device.last_sync_at ? `last synced ${formatRelativeTime(device.last_sync_at)}` : "not synced yet",
    ].filter(Boolean);
    detail.textContent = statusBits.join(" · ");

    meta.appendChild(title);
    meta.appendChild(detail);

    const actions = document.createElement("div");
    actions.className = "device-actions";

    const badge = document.createElement("span");
    badge.className = syncChipClass(device.status === "active" ? "success" : "neutral");
    badge.textContent = device.status === "active" ? "Active" : "Revoked";
    actions.appendChild(badge);

    if (device.status === "active") {
      const revoke = document.createElement("button");
      revoke.className = "button button-danger";
      revoke.type = "button";
      revoke.textContent = "Revoke";
      revoke.onclick = async () => {
        const confirmed = window.confirm(`Revoke ${device.device_name}? Dex on that machine will need ./dex login again.`);
        if (!confirmed) {
          return;
        }
        try {
          await apiFetch(`/api/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
          await refreshSettingsData();
        } catch (error) {
          state.saveStatus = "error";
          state.saveError = error instanceof Error ? error.message : "Could not revoke device.";
          renderSettings();
        }
      };
      actions.appendChild(revoke);
    }

    item.appendChild(meta);
    item.appendChild(actions);
    refs.devicesList.appendChild(item);
  });
}

function renderBanner(refs) {
  const latestDevice = mostRecentDevice(getActiveDevices(state.devices));
  if (!state.signedIn) {
    refs.bannerTitle.textContent = "Sign in to load your Dex settings";
    refs.bannerBody.textContent = "Your saved values appear here after sign-in. Until then, the fields stay empty.";
    refs.bannerPrimaryAction.textContent = "Sign in";
    refs.bannerPrimaryAction.onclick = openSignIn;
    setButtonTooltip(refs.bannerPrimaryAction, "");
    refs.bannerSecondaryAction.textContent = "Download Dex";
    refs.bannerSecondaryAction.onclick = openInstallUrl;
    setButtonTooltip(refs.bannerSecondaryAction, "");
    return;
  }

  if (state.pageState === "linked") {
    refs.bannerTitle.textContent = "Linked and syncing";
    refs.bannerBody.textContent = latestDevice
      ? `${latestDevice.device_name} is linked. Claude Code can auto-pull on session start. Cursor still needs a manual ./dex sync --pull.`
      : "Your profile has at least one linked device. Claude Code can auto-pull on session start. Cursor still needs a manual ./dex sync --pull.";
    refs.bannerPrimaryAction.textContent = "View linked devices";
    refs.bannerPrimaryAction.onclick = () => {
      activateSettingsPanel("section-devices", true);
    };
    setButtonTooltip(refs.bannerPrimaryAction, "");
    refs.bannerSecondaryAction.textContent = "Copy ./dex sync --pull";
    refs.bannerSecondaryAction.onclick = () => copyText("./dex sync --pull", "Copied ./dex sync --pull");
    setButtonTooltip(
      refs.bannerSecondaryAction,
      "Copies the command you run in Dex to pull this saved web profile onto that machine.",
    );
    return;
  }

  if (state.pageState === "web_first") {
    refs.bannerTitle.textContent = "You have a Dex profile, but no machine is linked yet";
    refs.bannerBody.textContent = "Set yourself up here first. When you install Dex later and run ./dex login, this saved profile will come down automatically.";
    refs.bannerPrimaryAction.textContent = "Download Dex";
    refs.bannerPrimaryAction.onclick = openInstallUrl;
    setButtonTooltip(refs.bannerPrimaryAction, "");
    refs.bannerSecondaryAction.textContent = "Copy ./dex login";
    refs.bannerSecondaryAction.onclick = () => copyText("./dex login", "Copied ./dex login");
    setButtonTooltip(
      refs.bannerSecondaryAction,
      "Copies the command you paste into Dex to link your local Dex profile to heydex.ai.",
    );
    return;
  }

  refs.bannerTitle.textContent = "Already using Dex locally?";
  refs.bannerBody.textContent = "Run ./dex login inside your Dex folder to connect this machine to the profile on this page. If local and web profiles differ, Dex will ask which one should win.";
  refs.bannerPrimaryAction.textContent = "Copy ./dex login";
  refs.bannerPrimaryAction.onclick = () => copyText("./dex login", "Copied ./dex login");
  setButtonTooltip(
    refs.bannerPrimaryAction,
    "Copies the command you paste into Dex to link your local Dex profile to heydex.ai.",
  );
  refs.bannerSecondaryAction.textContent = "Download Dex";
  refs.bannerSecondaryAction.onclick = openInstallUrl;
  setButtonTooltip(refs.bannerSecondaryAction, "");
}

function renderSyncStatus(refs) {
  const activeDevices = getActiveDevices(state.devices);
  if (state.pageState === "linked") {
    refs.syncChip.className = syncChipClass("success");
    refs.syncChip.textContent = "Linked";
    const latest = mostRecentDevice(activeDevices);
    refs.syncNote.textContent = latest?.last_sync_at
      ? `${latest.device_name} last synced ${formatRelativeTime(latest.last_sync_at)}.`
      : "At least one device is linked. The next apply behavior depends on the harness.";
    return;
  }

  if (state.pageState === "web_first") {
    refs.syncChip.className = syncChipClass("warning");
    refs.syncChip.textContent = "No device linked yet";
    refs.syncNote.textContent = "You can save your profile now and link a Dex machine later.";
    return;
  }

  refs.syncChip.className = syncChipClass("warning");
  refs.syncChip.textContent = "Not linked";
  refs.syncNote.textContent = "Run ./dex login on a Dex machine to bring your local profile here or pull the saved web profile down.";
}

function renderSettings() {
  const refs = getRefs();
  state.pageState = derivePageState({
    signedIn: state.signedIn,
    profile: state.profile,
    devices: state.devices,
  });

  renderAuthChrome(refs);
  refs.appShell.classList.toggle("hidden", false);
  refs.refreshData.classList.toggle("hidden", !state.signedIn);
  refs.refreshData.onclick = refreshSettingsData;

  syncFormDisabled(!state.signedIn);
  syncFormValues(refs);
  renderBanner(refs);
  renderSyncStatus(refs);
  renderDevices(refs);
  renderDeviceFacts(refs);
  renderFlowSteps(refs);
  renderStaticLists(refs);
  activateSettingsPanel(
    state.activeSettingsPanel || window.location.hash.replace("#", "") || "section-profile",
  );

  const statusText = formatSaveStatus();
  refs.saveStatusInline.textContent = statusText;
  refs.saveStatusBlock.textContent = statusText;
  refs.saveStatusBlock.classList.toggle("is-error", state.saveStatus === "error");
}

async function refreshSettingsData() {
  if (!state.signedIn) {
    return;
  }

  const refs = getRefs();
  refs.saveStatusInline.textContent = "Loading your profile…";
  refs.saveStatusBlock.textContent = "Loading your profile…";

  try {
    const [profileResponse, devicesResponse] = await Promise.all([
      apiFetch("/api/profile"),
      apiFetch("/api/devices"),
    ]);
    state.profile = normalizeProfile(profileResponse.profile);
    state.profileVersion = profileResponse.version || 0;
    state.profileUpdatedAt = profileResponse.updated_at || "";
    state.devices = Array.isArray(devicesResponse) ? devicesResponse : [];
    state.saveStatus = "idle";
    state.saveError = "";
  } catch (error) {
    state.saveStatus = "error";
    state.saveError = error instanceof Error ? error.message : "Could not load profile data.";
  }

  renderSettings();
}

function queueSave() {
  if (!state.signedIn || page !== "settings") {
    return;
  }
  state.saveStatus = "saving";
  renderSettings();
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => {
    void saveProfile();
  }, 900);
}

async function saveProfile() {
  if (!state.signedIn || page !== "settings") {
    return;
  }

  if (state.saveInFlight) {
    state.pendingResave = true;
    return;
  }

  state.saveInFlight = true;
  state.saveStatus = "saving";
  renderSettings();

  try {
    const response = await apiFetch("/api/profile", {
      method: "PUT",
      body: normalizeProfile(state.profile),
    });
    state.profile = normalizeProfile(response.profile);
    state.profileVersion = response.version || state.profileVersion;
    state.profileUpdatedAt = response.updated_at || new Date().toISOString();
    state.saveStatus = "idle";
    state.saveError = "";
  } catch (error) {
    state.saveStatus = "error";
    state.saveError = error instanceof Error ? error.message : "Could not save profile.";
  } finally {
    state.saveInFlight = false;
    renderSettings();
    if (state.pendingResave) {
      state.pendingResave = false;
      queueSave();
    }
  }
}

function parseInputValue(input) {
  if (input.type === "checkbox") {
    return input.checked;
  }
  if (input.dataset.path === "quarterly_planning.enabled") {
    return input.value === "true";
  }
  if (input.dataset.path === "quarterly_planning.q1_start_month") {
    return Number.parseInt(input.value, 10) || 1;
  }
  return input.value;
}

function bindSettingsEvents(refs) {
  refs.navItems.forEach((item) => {
    item.addEventListener("click", (event) => {
      const targetId = item.dataset.navTarget;
      event.preventDefault();
      activateSettingsPanel(targetId, true);
    });
  });

  window.addEventListener("hashchange", () => {
    activateSettingsPanel(window.location.hash.replace("#", "") || refs.navItems[0]?.dataset.navTarget);
  });

  activateSettingsPanel(window.location.hash.replace("#", "") || refs.navItems[0]?.dataset.navTarget);

  refs.pathInputs.forEach((input) => {
    const handler = () => {
      if (state.isHydrating) {
        return;
      }
      setPath(state.profile, input.dataset.path, parseInputValue(input));
      queueSave();
      renderSettings();
    };
    input.addEventListener(input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input", handler);
  });

  refs.chipGroups.forEach((group) => {
    group.addEventListener("click", (event) => {
      const chip = event.target.closest(".chip");
      if (!chip || state.isHydrating || !state.signedIn) {
        return;
      }
      setPath(state.profile, group.dataset.chipGroup, chip.dataset.value);
      queueSave();
      renderSettings();
    });
  });

  refs.presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.signedIn) {
        return;
      }
      state.profile = applyMeetingPreset(state.profile, button.dataset.meetingPreset);
      queueSave();
      renderSettings();
    });
  });

  refs.copyLoginInline.onclick = () => copyText("./dex login", "Copied ./dex login");
  setButtonTooltip(
    refs.copyLoginInline,
    "Copies the command you paste into Dex to link your local Dex profile to heydex.ai.",
  );
}

function renderLinkFacts(refs) {
  refs.linkFacts.innerHTML = "";
  const items = [];
  if (state.linkCode) {
    items.push({ label: "Link code", value: state.linkCode.toUpperCase() });
  }
  if (state.linkInfo?.device_name) {
    items.push({ label: "Device", value: state.linkInfo.device_name });
  }
  if (state.linkInfo?.harness) {
    items.push({
      label: "Harness",
      value: state.linkInfo.harness === "claude_code" ? "Claude Code" : state.linkInfo.harness,
    });
  }
  if (state.linkInfo?.platform) {
    items.push({ label: "Platform", value: state.linkInfo.platform });
  }
  if (state.linkInfo?.expires_at) {
    items.push({ label: "Expires", value: formatRelativeTime(state.linkInfo.expires_at) });
  }

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "link-meta-item";
    const label = document.createElement("span");
    label.textContent = item.label;
    const value = document.createElement("strong");
    value.textContent = item.value;
    row.appendChild(label);
    row.appendChild(value);
    refs.linkFacts.appendChild(row);
  });
}

function renderLinkPage() {
  const refs = getRefs();
  renderAuthChrome(refs);
  renderLinkFacts(refs);
  refs.backToSettingsLink.href = "/settings/";

  refs.approveButton.disabled = !state.signedIn || state.linkStatus !== "pending" || state.approveInFlight;
  refs.approveButton.textContent = state.approveInFlight ? "Approving…" : "Approve this device";
  refs.linkError.textContent = state.linkError;

  if (state.linkStatus === "missing_code") {
    refs.linkStatusChip.className = syncChipClass("danger");
    refs.linkStatusChip.textContent = "Missing code";
    refs.linkTitle.textContent = "This link is missing its device code";
    refs.linkBody.textContent = "Run ./dex login again so Dex can open a fresh approval page with a valid code.";
    return;
  }

  if (state.linkStatus === "loading") {
    refs.linkStatusChip.className = syncChipClass("neutral");
    refs.linkStatusChip.textContent = "Checking code…";
    refs.linkTitle.textContent = "Looking up your device link";
    refs.linkBody.textContent = "Checking the link code from Dex.";
    return;
  }

  if (state.linkStatus === "expired") {
    refs.linkStatusChip.className = syncChipClass("danger");
    refs.linkStatusChip.textContent = "Expired";
    refs.linkTitle.textContent = "This device code expired";
    refs.linkBody.textContent = "Run ./dex login again to generate a fresh device link.";
    return;
  }

  if (state.linkStatus === "not_found") {
    refs.linkStatusChip.className = syncChipClass("danger");
    refs.linkStatusChip.textContent = "Unknown code";
    refs.linkTitle.textContent = "That device link could not be found";
    refs.linkBody.textContent = "Run ./dex login again so Dex can generate a valid device code.";
    return;
  }

  if (state.linkStatus === "approved") {
    refs.linkStatusChip.className = syncChipClass("success");
    refs.linkStatusChip.textContent = "Approved";
    refs.linkTitle.textContent = "This Dex device is approved";
    refs.linkBody.textContent = "Return to Dex. It will finish linking automatically and then reconcile local versus web profile data if needed.";
    return;
  }

  refs.linkStatusChip.className = syncChipClass("warning");
  refs.linkStatusChip.textContent = "Ready to approve";
  refs.linkTitle.textContent = "Approve this Dex device";
  refs.linkBody.textContent = state.signedIn
    ? "Review the device details below, then approve it so Dex can use your roaming profile."
    : "Sign in first, then approve this device so Dex can use your roaming profile.";
}

async function refreshLinkRequest() {
  if (!state.linkCode) {
    state.linkStatus = "missing_code";
    renderLinkPage();
    return;
  }

  state.linkStatus = "loading";
  renderLinkPage();

  try {
    const response = await apiFetch(`/api/auth/device/poll?link_code=${encodeURIComponent(state.linkCode)}`, {
      authenticated: false,
    });
    state.linkInfo = response;
    state.linkStatus = response.status || "not_found";
    state.linkError = "";
  } catch (error) {
    state.linkStatus = "not_found";
    state.linkError = error instanceof Error ? error.message : "Could not check this link code.";
  }

  renderLinkPage();
}

async function approveLink() {
  if (!state.signedIn || !state.linkCode) {
    return;
  }

  state.approveInFlight = true;
  state.linkError = "";
  renderLinkPage();

  try {
    const response = await apiFetch("/api/auth/device/approve", {
      method: "POST",
      body: { link_code: state.linkCode },
    });
    state.linkStatus = "approved";
    state.linkInfo = Object.assign({}, state.linkInfo || {}, {
      status: "approved",
      device_name: response.device_name || state.linkInfo?.device_name,
    });
  } catch (error) {
    state.linkError = error instanceof Error ? error.message : "Could not approve this device.";
  } finally {
    state.approveInFlight = false;
    renderLinkPage();
  }
}

function bindLinkEvents(refs) {
  refs.approveButton.onclick = approveLink;
}

async function openSignIn() {
  if (!state.clerk) {
    return;
  }
  await state.clerk.openSignIn({
    afterSignInUrl: window.location.href,
    afterSignUpUrl: window.location.href,
  });
}

function renderPage() {
  if (page === "settings") {
    renderSettings();
  } else {
    renderLinkPage();
  }
}

async function start() {
  const refs = getRefs();
  if (page === "settings") {
    populateSelects(refs);
    renderStaticLists(refs);
    bindSettingsEvents(refs);
  } else {
    bindLinkEvents(refs);
    await refreshLinkRequest();
  }

  renderPage();
  await initAuth();
}

start();

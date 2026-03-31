export const DEFAULT_PROFILE = Object.freeze({
  name: "",
  role: "",
  role_group: "",
  company: "",
  company_size: "",
  email_domain: "",
  communication: {
    formality: "professional_casual",
    directness: "balanced",
    detail_level: "concise",
    career_level: "mid",
    coaching_style: "collaborative",
  },
  meeting_intelligence: {
    extract_customer_intel: false,
    extract_competitive_intel: false,
    extract_action_items: true,
    extract_decisions: true,
    extract_stakeholder_dynamics: false,
    extract_budget_timeline: false,
    extract_technical_decisions: false,
  },
  journaling: {
    morning: false,
    evening: false,
    weekly: false,
  },
  quarterly_planning: {
    enabled: false,
    q1_start_month: 1,
  },
});

export const COMPANY_SIZE_OPTIONS = [
  { value: "", label: "Select company size" },
  { value: "solo", label: "Solo" },
  { value: "startup", label: "Startup (1-100)" },
  { value: "scale_up", label: "Scale-up (100-1000)" },
  { value: "enterprise", label: "Enterprise (1000+)" },
];

export const ROLE_GROUP_OPTIONS = [
  { value: "", label: "Select role group" },
  { value: "leadership", label: "Leadership" },
  { value: "product", label: "Product" },
  { value: "engineering", label: "Engineering" },
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "customer_success", label: "Customer success" },
  { value: "operations", label: "Operations" },
  { value: "finance", label: "Finance" },
  { value: "people", label: "People / HR" },
  { value: "other", label: "Other" },
];

export const FORMALITY_OPTIONS = [
  { value: "casual", label: "Casual" },
  { value: "professional_casual", label: "Professional casual" },
  { value: "formal", label: "Formal" },
];

export const DIRECTNESS_OPTIONS = [
  { value: "supportive", label: "Supportive" },
  { value: "balanced", label: "Balanced" },
  { value: "very_direct", label: "Very direct" },
];

export const DETAIL_LEVEL_OPTIONS = [
  { value: "concise", label: "Concise" },
  { value: "balanced", label: "Balanced" },
  { value: "comprehensive", label: "Comprehensive" },
];

export const CAREER_LEVEL_OPTIONS = [
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" },
  { value: "leadership", label: "Leadership" },
  { value: "c_suite", label: "C-suite" },
];

export const COACHING_STYLE_OPTIONS = [
  { value: "encouraging", label: "Encouraging" },
  { value: "collaborative", label: "Collaborative" },
  { value: "challenging", label: "Challenging" },
];

export const MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

export const WHAT_SYNCS = Object.freeze([
  "Profile basics: name, role, company, company size, and email domain",
  "How Dex should sound: formality, directness, detail level, career level, and coaching style",
  "Meeting intelligence choices for action items, decisions, customer intel, and related signals",
  "Reflection preferences for morning, evening, and weekly journaling",
  "Quarterly planning on or off, plus when Q1 starts",
]);

export const WHAT_STAYS_LOCAL = Object.freeze([
  "API keys and provider configuration",
  "MCP setup and local permissions",
  "Hooks and automation rules",
  "Vault paths, Spaces, and other file locations",
  "Theme, palette, layout, and local UI state",
  "Anything secret-bearing or specific to one machine",
]);

export const MEETING_PRESETS = Object.freeze({
  customer: Object.freeze({
    extract_customer_intel: true,
    extract_competitive_intel: false,
    extract_action_items: true,
    extract_decisions: true,
    extract_stakeholder_dynamics: true,
    extract_budget_timeline: true,
    extract_technical_decisions: false,
  }),
  leadership: Object.freeze({
    extract_customer_intel: false,
    extract_competitive_intel: false,
    extract_action_items: true,
    extract_decisions: true,
    extract_stakeholder_dynamics: true,
    extract_budget_timeline: false,
    extract_technical_decisions: false,
  }),
  product: Object.freeze({
    extract_customer_intel: true,
    extract_competitive_intel: false,
    extract_action_items: true,
    extract_decisions: true,
    extract_stakeholder_dynamics: false,
    extract_budget_timeline: false,
    extract_technical_decisions: true,
  }),
  minimal: Object.freeze({
    extract_customer_intel: false,
    extract_competitive_intel: false,
    extract_action_items: true,
    extract_decisions: true,
    extract_stakeholder_dynamics: false,
    extract_budget_timeline: false,
    extract_technical_decisions: false,
  }),
});

export function cloneProfile(profile = DEFAULT_PROFILE) {
  return JSON.parse(JSON.stringify(profile));
}

function pickString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function pickBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function pickInteger(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 12) {
    return parsed;
  }
  return fallback;
}

export function normalizeProfile(profile = {}) {
  const next = cloneProfile(DEFAULT_PROFILE);
  const source = profile || {};

  next.name = pickString(source.name);
  next.role = pickString(source.role);
  next.role_group = pickString(source.role_group);
  next.company = pickString(source.company);
  next.company_size = pickString(source.company_size);
  next.email_domain = pickString(source.email_domain);

  const communication = source.communication || {};
  next.communication.formality = pickString(
    communication.formality,
    DEFAULT_PROFILE.communication.formality,
  );
  next.communication.directness = pickString(
    communication.directness,
    DEFAULT_PROFILE.communication.directness,
  );
  next.communication.detail_level = pickString(
    communication.detail_level,
    DEFAULT_PROFILE.communication.detail_level,
  );
  next.communication.career_level = pickString(
    communication.career_level,
    DEFAULT_PROFILE.communication.career_level,
  );
  next.communication.coaching_style = pickString(
    communication.coaching_style,
    DEFAULT_PROFILE.communication.coaching_style,
  );

  const meeting = source.meeting_intelligence || {};
  next.meeting_intelligence.extract_customer_intel = pickBoolean(
    meeting.extract_customer_intel,
    DEFAULT_PROFILE.meeting_intelligence.extract_customer_intel,
  );
  next.meeting_intelligence.extract_competitive_intel = pickBoolean(
    meeting.extract_competitive_intel,
    DEFAULT_PROFILE.meeting_intelligence.extract_competitive_intel,
  );
  next.meeting_intelligence.extract_action_items = pickBoolean(
    meeting.extract_action_items,
    DEFAULT_PROFILE.meeting_intelligence.extract_action_items,
  );
  next.meeting_intelligence.extract_decisions = pickBoolean(
    meeting.extract_decisions,
    DEFAULT_PROFILE.meeting_intelligence.extract_decisions,
  );
  next.meeting_intelligence.extract_stakeholder_dynamics = pickBoolean(
    meeting.extract_stakeholder_dynamics,
    DEFAULT_PROFILE.meeting_intelligence.extract_stakeholder_dynamics,
  );
  next.meeting_intelligence.extract_budget_timeline = pickBoolean(
    meeting.extract_budget_timeline,
    DEFAULT_PROFILE.meeting_intelligence.extract_budget_timeline,
  );
  next.meeting_intelligence.extract_technical_decisions = pickBoolean(
    meeting.extract_technical_decisions,
    DEFAULT_PROFILE.meeting_intelligence.extract_technical_decisions,
  );

  const journaling = source.journaling || {};
  next.journaling.morning = pickBoolean(journaling.morning, DEFAULT_PROFILE.journaling.morning);
  next.journaling.evening = pickBoolean(journaling.evening, DEFAULT_PROFILE.journaling.evening);
  next.journaling.weekly = pickBoolean(journaling.weekly, DEFAULT_PROFILE.journaling.weekly);

  const quarterlyPlanning = source.quarterly_planning || {};
  next.quarterly_planning.enabled = pickBoolean(
    quarterlyPlanning.enabled,
    DEFAULT_PROFILE.quarterly_planning.enabled,
  );
  next.quarterly_planning.q1_start_month = pickInteger(
    quarterlyPlanning.q1_start_month,
    DEFAULT_PROFILE.quarterly_planning.q1_start_month,
  );

  return next;
}

export function isDefaultProfile(profile) {
  return JSON.stringify(normalizeProfile(profile)) === JSON.stringify(DEFAULT_PROFILE);
}

export function hasMeaningfulProfile(profile) {
  return !isDefaultProfile(profile);
}

export function getActiveDevices(devices = []) {
  return devices.filter((device) => device && device.status === "active");
}

export function derivePageState({ signedIn, profile, devices }) {
  if (!signedIn) {
    return "signed_out";
  }
  if (getActiveDevices(devices).length > 0) {
    return "linked";
  }
  return hasMeaningfulProfile(profile) ? "web_first" : "existing_user";
}

export function detectMeetingPreset(profile) {
  const normalized = normalizeProfile(profile);
  const current = normalized.meeting_intelligence;

  for (const [key, preset] of Object.entries(MEETING_PRESETS)) {
    if (Object.keys(preset).every((field) => current[field] === preset[field])) {
      return key;
    }
  }

  return "custom";
}

export function applyMeetingPreset(profile, presetKey) {
  const preset = MEETING_PRESETS[presetKey];
  const next = normalizeProfile(profile);
  if (!preset) {
    return next;
  }
  next.meeting_intelligence = { ...preset };
  return next;
}

export function monthLabel(monthNumber) {
  return MONTH_OPTIONS.find((option) => option.value === Number(monthNumber))?.label || "January";
}

export function formatRelativeTime(timestamp, now = Date.now()) {
  if (!timestamp) {
    return "Never";
  }

  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) {
    return "Unknown";
  }

  const diffMs = now - time;
  const future = diffMs < 0;
  const diffMinutes = Math.floor(Math.abs(diffMs) / 60000);

  if (diffMinutes < 1) {
    return future ? "In under a minute" : "Just now";
  }
  if (diffMinutes < 60) {
    return future
      ? `In ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"}`
      : `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return future
      ? `In ${diffHours} hour${diffHours === 1 ? "" : "s"}`
      : `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return future
      ? `In ${diffDays} day${diffDays === 1 ? "" : "s"}`
      : `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }

  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function syncModeForHarness(harness = "") {
  if (harness === "claude_code") {
    return "Auto-pulls at session start";
  }
  if (harness === "cursor") {
    return "Manual `./dex sync --pull` for now";
  }
  return "Manual sync";
}

export function buildSummaryChips(profile) {
  const normalized = normalizeProfile(profile);
  const chips = [];

  chips.push(
    normalized.role
      ? normalized.role
      : "Profile basics still blank",
  );

  const directnessMap = {
    very_direct: "Very direct tone",
    balanced: "Balanced tone",
    supportive: "Supportive tone",
  };
  chips.push(directnessMap[normalized.communication.directness] || "Balanced tone");

  const detailMap = {
    concise: "Concise detail",
    balanced: "Balanced detail",
    comprehensive: "Comprehensive detail",
  };
  chips.push(detailMap[normalized.communication.detail_level] || "Balanced detail");

  const preset = detectMeetingPreset(normalized);
  const presetLabel = {
    customer: "Meeting focus: customer-facing",
    leadership: "Meeting focus: leadership",
    product: "Meeting focus: product collaboration",
    minimal: "Meeting focus: minimal",
    custom: "Meeting focus: custom",
  };
  chips.push(presetLabel[preset] || "Meeting focus: custom");

  const reflections = [];
  if (normalized.journaling.morning) {
    reflections.push("morning");
  }
  if (normalized.journaling.evening) {
    reflections.push("evening");
  }
  if (normalized.journaling.weekly) {
    reflections.push("weekly");
  }
  chips.push(
    reflections.length > 0
      ? `Reflection: ${reflections.join(", ")}`
      : "Reflection: off",
  );

  chips.push(
    normalized.quarterly_planning.enabled
      ? `Quarterly planning from ${monthLabel(normalized.quarterly_planning.q1_start_month)}`
      : "Quarterly planning off",
  );

  return chips;
}

export function mostRecentDevice(devices = []) {
  const candidates = [...devices].sort((left, right) => {
    const leftTime = new Date(left.last_sync_at || left.last_seen_at || left.linked_at || 0).getTime();
    const rightTime = new Date(right.last_sync_at || right.last_seen_at || right.linked_at || 0).getTime();
    return rightTime - leftTime;
  });
  return candidates[0] || null;
}

export function buildDeviceFacts(devices = []) {
  const activeDevices = getActiveDevices(devices);
  const latestDevice = mostRecentDevice(activeDevices.length > 0 ? activeDevices : devices);

  if (!latestDevice) {
    return [
      { label: "Linked device", value: "None yet" },
      { label: "Claude Code", value: "Will auto-pull after you run `./dex login`" },
      { label: "Cursor", value: "Manual `./dex sync --pull` after linking" },
      { label: "Scope", value: "Roaming profile only" },
    ];
  }

  return [
    { label: "Linked device", value: latestDevice.device_name || "Unknown device" },
    { label: "Harness", value: latestDevice.harness || "Unknown" },
    { label: "Platform", value: latestDevice.platform || "Unknown" },
    { label: "Apply behavior", value: syncModeForHarness(latestDevice.harness) },
  ];
}

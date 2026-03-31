import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PROFILE,
  MEETING_PRESETS,
  applyMeetingPreset,
  buildDeviceFacts,
  buildSummaryChips,
  derivePageState,
  formatRelativeTime,
  hasMeaningfulProfile,
  normalizeProfile,
} from "./logic.mjs";

test("normalizeProfile keeps only the whitelisted Phase 1 fields", () => {
  const normalized = normalizeProfile({
    name: "Dave",
    role: "Founder",
    screenpipe: { enabled: true },
    communication: { directness: "very_direct" },
    quarterly_planning: { enabled: true, q1_start_month: 4, advanced: "ignore me" },
  });

  assert.equal(normalized.name, "Dave");
  assert.equal(normalized.role, "Founder");
  assert.equal(normalized.communication.directness, "very_direct");
  assert.equal(normalized.quarterly_planning.enabled, true);
  assert.equal(normalized.quarterly_planning.q1_start_month, 4);
  assert.equal("screenpipe" in normalized, false);
  assert.deepEqual(Object.keys(normalized).sort(), Object.keys(DEFAULT_PROFILE).sort());
});

test("derivePageState picks the three website states from sign-in, profile, and devices", () => {
  assert.equal(
    derivePageState({ signedIn: true, profile: DEFAULT_PROFILE, devices: [] }),
    "existing_user",
  );

  assert.equal(
    derivePageState({
      signedIn: true,
      profile: { ...DEFAULT_PROFILE, name: "Dave" },
      devices: [],
    }),
    "web_first",
  );

  assert.equal(
    derivePageState({
      signedIn: true,
      profile: DEFAULT_PROFILE,
      devices: [{ id: "dev_1", status: "active" }],
    }),
    "linked",
  );
});

test("meeting presets round-trip through detection", () => {
  const profile = applyMeetingPreset(DEFAULT_PROFILE, "product");
  assert.deepEqual(profile.meeting_intelligence, MEETING_PRESETS.product);
});

test("meaningful profile detection ignores the empty default object", () => {
  assert.equal(hasMeaningfulProfile(DEFAULT_PROFILE), false);
  assert.equal(hasMeaningfulProfile({ ...DEFAULT_PROFILE, company: "Dex" }), true);
});

test("summary chips reflect the saved profile state", () => {
  const chips = buildSummaryChips({
    role: "VP Product",
    communication: { directness: "very_direct", detail_level: "balanced" },
    meeting_intelligence: MEETING_PRESETS.product,
    journaling: { morning: true, evening: false, weekly: true },
    quarterly_planning: { enabled: true, q1_start_month: 4 },
  });

  assert.ok(chips.includes("VP Product"));
  assert.ok(chips.includes("Very direct tone"));
  assert.ok(chips.includes("Balanced detail"));
  assert.ok(chips.includes("Meeting focus: product collaboration"));
  assert.ok(chips.includes("Reflection: morning, weekly"));
  assert.ok(chips.includes("Quarterly planning from April"));
});

test("device facts fall back to clear linking guidance when no device is linked", () => {
  const facts = buildDeviceFacts([]);
  assert.deepEqual(facts[0], { label: "Linked device", value: "None yet" });
  assert.equal(facts[1].label, "Claude Code");
});

test("relative time stays plain English", () => {
  const now = new Date("2026-03-10T12:00:00Z").getTime();
  assert.equal(formatRelativeTime("2026-03-10T11:59:30Z", now), "Just now");
  assert.equal(formatRelativeTime("2026-03-10T11:40:00Z", now), "20 minutes ago");
  assert.equal(formatRelativeTime("2026-03-10T09:00:00Z", now), "3 hours ago");
});

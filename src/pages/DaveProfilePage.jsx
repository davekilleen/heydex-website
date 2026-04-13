import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation } from 'convex/react';

// ── Diff data ──────────────────────────────────────────────────────────────

const DIFFS = [
  {
    slug: 'meeting-intelligence',
    title: 'Meeting Intelligence',
    tagline: 'recordings → compounding intel',
    problem: "You finish a call, scribble some notes, and move on. A week later you can't remember what was agreed. Every meeting generates context that could make your next meeting better — but it sits in a recording nobody will re-listen to.",
    solution: "One command after any recorded meeting turns the recording into a structured note — decisions, action items split by owner, competitive mentions, customer pain points. Then updates each attendee's page, catches commitments the first pass missed, and suggests connections to follow up on.",
    baseline: 'Dex-core: meeting prep briefs and basic note processing.',
    adds: 'This adds: deep recording integration, missed action extraction, batch processing, connection suggestions, background queue monitoring.',
    commands: [
      { name: '/process-meeting', desc: 'single recording → structured note' },
      { name: '/process-daily-meetings', desc: "batch process today's calls" },
      { name: '/find-missed-commitments', desc: 'scan for slipped promises' },
      { name: '/review-connections', desc: 'surface new contacts and links' },
    ],
  },
  {
    slug: 'deal-intelligence',
    title: 'Deal Intelligence',
    tagline: 'portfolio health + coaching',
    problem: "You're across 30 deals. You can't hold the status of each one in your head. By the time you realise a champion has gone quiet, it's been three weeks. You find out about competitive threats during forecast reviews — not when they first appear in a transcript.",
    solution: "One command scans your entire portfolio and flags what needs attention — deals gone quiet, MEDDPICC gaps, missed follow-ups. Another analyses call transcripts for a specific deal and coaches you on where the conversation is weak.",
    baseline: 'Dex-core: people pages and meeting notes.',
    adds: 'This adds: portfolio-wide health monitoring, transcript-based coaching, continuous deal page enrichment from every interaction.',
    commands: [
      { name: '/deals-attention', desc: 'portfolio triage — what needs you now?' },
      { name: '/analyze-deal', desc: 'coaching analysis from transcripts' },
      { name: '/add-deal', desc: 'start tracking a company' },
    ],
  },
  {
    slug: 'relationship-compounding',
    title: 'Relationship Compounding',
    tagline: 'every interaction → smarter next one',
    problem: "You meet someone at a conference, have a great conversation, and three months later can't remember what you discussed. Every relationship starts from scratch because nothing connects.",
    solution: "When you write a meeting note, every person mentioned gets automatically linked to their contact page. When commitments slip or relationships go stale, Dex generates ready-to-send messages. Your weekly stakeholder update writes itself from actual work.",
    baseline: 'Dex-core: person pages and context injection.',
    adds: 'This adds: automatic cross-referencing, context-aware message drafting, stakeholder updates from real activity.',
    commands: [
      { name: '/link-people', desc: 'scan files, update contact pages' },
      { name: '/draft-messages', desc: 'messages from detected gaps' },
      { name: '/stakeholder-update', desc: 'weekly synthesis for your manager' },
    ],
  },
  {
    slug: 'weekly-rhythm',
    title: 'Weekly Operating Rhythm',
    tagline: 'clarity Mon → evidence Fri',
    problem: "Monday morning: you react to whatever's in front of you. Friday evening: someone asks what you shipped and you can't articulate it. Your quarterly goals exist in a document you haven't looked at in three weeks.",
    solution: "Morning planning starts with your deals, not your calendar. Parallel intel pipelines scan social, newsletters, and competitive channels. Pillar balance tracking catches drift within a week. Friday auto-drafts a leadership update from real evidence.",
    baseline: 'Dex-core: daily planning, daily review, weekly planning, weekly review.',
    adds: 'This adds: deal-first framing, parallel intel pipelines, pillar balance tracking, meeting gap detection, closed-loop cadence.',
    commands: [
      { name: '/daily-plan', desc: 'deal-first morning with real-time intel' },
      { name: '/daily-review', desc: 'evening capture + meeting gap detection' },
      { name: '/week-plan', desc: 'priorities linked to quarterly goals' },
      { name: '/week-review', desc: 'evidence-based synthesis' },
    ],
  },
  {
    slug: 'accountability',
    title: 'Accountability & Cracks Detection',
    tagline: 'nothing falls through',
    problem: "You promised someone you'd send something by Thursday. It's now the following Tuesday and you've forgotten. A project has quietly stalled. Performance review season arrives and you spend 3 hours reconstructing your impact from memory.",
    solution: "One command scans your vault for slipped commitments — things with dates that have passed, people waiting on you. Another gives you a health dashboard across all active projects. Background automation passively captures decisions, impact, and feedback as career evidence.",
    baseline: 'Dex-core: task tracking and project pages.',
    adds: 'This adds: proactive crack detection, initiative-wide health dashboards, automatic career evidence capture.',
    commands: [
      { name: '/cracks', desc: 'scan for slipped commitments' },
      { name: '/project-health', desc: 'red/yellow/green across initiatives' },
    ],
  },
  {
    slug: 'thought-leadership',
    title: 'Thought Leadership Pipeline',
    tagline: 'expertise → published content',
    problem: "You have strong opinions and give great talks. But between having the thought and publishing it, there's a 4-hour gap. Most ideas die in your head. Meanwhile, you're not tracking competitors systematically.",
    solution: "Drop a podcast transcript and get a LinkedIn post in your voice in under 2 minutes. Scan competitors and market trends. Post to social from the command line. For longer pieces, a full pipeline takes your brief through drafting and a 22-agent review squad.",
    baseline: 'Dex-core: content creation tools.',
    adds: 'This adds: podcast-to-social pipeline, competitive intel scanning, social integration, multi-agent content review.',
    commands: [
      { name: '/podcast-to-social', desc: 'transcript → LinkedIn post' },
      { name: '/competitive-intel', desc: 'market scanning' },
      { name: '/create-article', desc: 'brief → draft → 22-agent review' },
    ],
  },
  {
    slug: 'self-improving-system',
    title: 'Self-Improving System',
    tagline: 'every session → smarter next one',
    problem: "You correct your AI. Next session, it makes the same mistake. Over time, you repeat the same instructions hundreds of times. Your AI never learns your preferences and never gets better at working with you specifically.",
    solution: "Background automations watch every session and learn. Corrections are captured. Patterns are recorded. A guard runs before every action and checks against known mistakes. It tracks which files you actually use, building a picture of your real workflows over time.",
    baseline: 'Dex-core: session memory and basic observation.',
    adds: 'This adds: automatic learning capture, pattern detection, mistake prevention, usage analysis, a living model of your working style.',
    commands: [
      { name: '/save-insight', desc: 'capture compound learnings' },
      { name: '/identity-snapshot', desc: 'your working pattern model' },
      { name: '/learnings', desc: 'what the system has learned' },
    ],
  },
];

// ── Adopt steps (shared) ───────────────────────────────────────────────────

const ADOPT_STEPS = [
  { label: 'Preview', body: "Dex runs the workflow once against your real data so you can see the output before committing. Nothing is installed." },
  { label: 'Compatibility check', body: "Dex checks which integrations you have connected and what the workflow can do with and without each one." },
  { label: 'Role tailoring', body: "Dex reads your role from your profile and adapts the workflow output to match how you actually work." },
  { label: 'Setup plan', body: "Dex shows you exactly what it will create — which commands, which automations, what guidance — and you approve before anything is written." },
  { label: 'Build', body: "Dex generates everything tailored to your vault — your folders, your integrations, your role. Nothing from Dave's system is copied." },
  { label: 'First run', body: "Dex walks you through using the workflow for the first time with a concrete example from your own data." },
];

// ── CSS ────────────────────────────────────────────────────────────────────

const PAGE_CSS = `
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg-base: #0a0a0a;
    --bg-surface: #111111;
    --bg-elevated: #161616;
    --bg-hover: #1a1a1a;
    --bg-selected: #1f1a0f;
    --border-subtle: #1c1c1c;
    --border-default: #222222;
    --border-strong: #333333;
    --text-primary: #f0f0f0;
    --text-secondary: #888888;
    --text-tertiary: #777777;
    --text-inverse: #0a0a0a;
    --accent: #FF3870;
    --accent-dim: #992244;
    --accent-bg: #1f0f15;
    --accent-border: #3d0a1e;
    --font-mono: 'Geist Mono', 'Berkeley Mono', 'JetBrains Mono', monospace;
    --font-sans: 'Geist', system-ui, sans-serif;
  }

  body {
    background: var(--bg-base);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    font-feature-settings: "kern" 1, "liga" 1, "calt" 1;
  }

  .dpp-content {
    display: block;
    max-width: 720px;
    margin: 0 auto;
    padding: 80px 24px 96px;
  }

  .dpp-nav {
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 50;
    background: rgba(10, 10, 10, 0.9);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border-subtle);
  }

  .dpp-nav-inner {
    max-width: 1100px;
    margin: 0 auto;
    padding: 0 24px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .dpp-nav-logo {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    text-decoration: none;
    letter-spacing: 0.02em;
  }

  .dpp-nav-links {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .dpp-nav-link {
    font-family: var(--font-mono);
    font-size: 11px;
    color: #aaaaaa;
    text-decoration: none;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    transition: color 80ms ease;
  }
  .dpp-nav-link:hover { color: var(--text-primary); }

  .dpp-nav-cta {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-inverse);
    background: var(--accent);
    border: none;
    padding: 6px 14px;
    border-radius: 2px;
    text-decoration: none;
    cursor: pointer;
    transition: opacity 80ms ease;
  }
  .dpp-nav-cta:hover { opacity: 0.85; }

  .dpp-auth-handle {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
  }

  .dpp-auth-logout {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: color 80ms ease;
    text-decoration: none;
    background: none;
    border: none;
  }
  .dpp-auth-logout:hover { color: var(--text-secondary); }

  .dpp-profile-header { margin-bottom: 48px; }

  .dpp-profile-name {
    font-family: var(--font-sans);
    font-size: 20px;
    font-weight: 500;
    color: var(--text-primary);
    letter-spacing: -0.01em;
    margin-bottom: 4px;
  }

  .dpp-profile-role {
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--text-secondary);
    margin-bottom: 20px;
  }

  .dpp-profile-quote {
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--text-secondary);
    font-style: italic;
    border-left: 2px solid var(--accent-border);
    padding-left: 12px;
    margin-bottom: 24px;
    line-height: 1.5;
  }

  .dpp-profile-intro {
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 24px;
  }
  .dpp-profile-intro p + p { margin-top: 12px; }

  .dpp-profile-adopt-box { margin-bottom: 8px; }

  .dpp-adopt-command {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--accent-bg);
    border: 1px solid var(--accent-border);
    border-radius: 2px;
    cursor: pointer;
    transition: background 80ms ease;
    margin-bottom: 8px;
  }
  .dpp-adopt-command:hover { background: rgba(255, 56, 112, 0.12); }

  .dpp-adopt-command-text {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--accent);
    flex: 1;
  }

  .dpp-adopt-command-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    flex-shrink: 0;
    transition: color 80ms ease;
  }
  .dpp-adopt-command:hover .dpp-adopt-command-btn { color: var(--text-secondary); }

  .dpp-adopt-command-hint {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    margin-bottom: 0;
  }

  .dpp-install-hint {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    margin-top: 10px;
  }
  .dpp-install-hint a {
    color: var(--text-tertiary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .dpp-install-hint a:hover { color: var(--text-secondary); }

  .dpp-divider {
    border: none;
    border-top: 1px solid var(--border-subtle);
    margin: 32px 0;
  }

  .dpp-section-label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 16px;
  }

  .dpp-filter-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .dpp-diff-filter {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dpp-filter-label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .dpp-filter-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 2px 8px;
    border: 1px solid var(--border-default);
    border-radius: 2px;
    background: transparent;
    cursor: pointer;
    transition: color 80ms ease, border-color 80ms ease, background 80ms ease;
  }
  .dpp-filter-btn:hover {
    color: var(--text-secondary);
    border-color: var(--border-strong);
  }
  .dpp-filter-btn.active {
    color: var(--accent);
    border-color: var(--accent-border);
    background: var(--accent-bg);
  }

  .dpp-diff-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--border-subtle);
    border: 1px solid var(--border-subtle);
    border-radius: 2px;
    overflow: hidden;
  }

  .dpp-diff-card {
    background: var(--bg-base);
    transition: background 80ms ease;
  }

  .dpp-diff-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    cursor: pointer;
    user-select: none;
    width: 100%;
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    text-align: left;
  }
  .dpp-diff-header:hover { background: var(--bg-hover); }
  .dpp-diff-header:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .dpp-diff-expand {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    width: 16px;
    text-align: center;
    flex-shrink: 0;
    transition: transform 120ms ease;
    display: inline-block;
  }
  .dpp-diff-expand.open { transform: rotate(90deg); }

  .dpp-diff-title {
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
  }

  .dpp-diff-tagline {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    flex-shrink: 0;
    display: none;
  }
  @media (min-width: 600px) { .dpp-diff-tagline { display: block; } }

  .dpp-diff-body {
    overflow: hidden;
    transition: max-height 120ms ease-in-out;
    max-height: 0;
  }
  .dpp-diff-body.open { max-height: 2000px; }

  .dpp-diff-body-inner {
    padding: 0 16px 20px 44px;
  }

  .dpp-diff-section-label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-top: 16px;
    margin-bottom: 6px;
  }
  .dpp-diff-section-label:first-child { margin-top: 0; }

  .dpp-diff-problem,
  .dpp-diff-solution,
  .dpp-diff-adds {
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .dpp-diff-baseline {
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--text-tertiary);
    font-style: italic;
    line-height: 1.6;
  }

  .dpp-diff-commands {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
  }

  .dpp-diff-cmd {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    padding: 4px 8px;
    background: var(--bg-surface);
    border-radius: 2px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dpp-diff-cmd-name {
    color: var(--text-primary);
    font-weight: 500;
  }

  .dpp-diff-cmd-desc {
    color: var(--text-tertiary);
    font-size: 11px;
  }

  .dpp-diff-adopt-row { margin-top: 16px; }

  .dpp-diff-adopt-cmd {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--accent-bg);
    border: 1px solid var(--accent-border);
    border-radius: 2px;
    cursor: pointer;
    transition: background 80ms ease;
  }
  .dpp-diff-adopt-cmd:hover { background: rgba(255, 56, 112, 0.12); }

  .dpp-diff-adopt-cmd-text {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--accent);
  }

  .dpp-diff-adopt-cmd-label {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .dpp-diff-adopt-cta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--accent-bg);
    border: 1px solid var(--accent-border);
    border-radius: 2px;
    cursor: pointer;
    transition: background 80ms ease;
    text-decoration: none;
  }
  .dpp-diff-adopt-cta:hover { background: rgba(255, 56, 112, 0.12); }

  .dpp-diff-adopted-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .dpp-diff-adopted-check {
    font-family: var(--font-mono);
    font-size: 12px;
    color: #22c55e;
  }

  .dpp-diff-adopted-text {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .dpp-diff-mark-adopted {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .dpp-diff-mark-link {
    color: var(--text-secondary);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color 80ms ease;
    background: none;
    border: none;
    font: inherit;
    padding: 0;
  }
  .dpp-diff-mark-link:hover { color: var(--text-primary); }

  .dpp-diff-adopt-explain { margin-top: 8px; }

  .dpp-diff-adopt-toggle {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: color 80ms ease;
    user-select: none;
    background: none;
    border: none;
    padding: 0;
  }
  .dpp-diff-adopt-toggle:hover { color: var(--text-secondary); }

  .dpp-diff-adopt-chevron {
    display: inline-block;
    font-size: 10px;
    transition: transform 120ms ease;
    font-style: normal;
  }
  .dpp-diff-adopt-chevron.open { transform: rotate(90deg); }

  .dpp-diff-adopt-detail {
    max-height: 0;
    overflow: hidden;
    transition: max-height 120ms ease-in-out;
  }
  .dpp-diff-adopt-detail.open { max-height: 500px; }

  .dpp-diff-adopt-steps {
    padding-left: 16px;
    margin: 8px 0 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .dpp-diff-adopt-steps li {
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.5;
  }
  .dpp-diff-adopt-steps strong {
    color: var(--text-secondary);
    font-weight: 500;
  }

  .dpp-compound-section { margin-top: 48px; }

  .dpp-compound-loop {
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
    padding-left: 0;
    list-style: none;
  }
  .dpp-compound-loop li {
    padding: 6px 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .dpp-compound-loop li:last-child { border-bottom: none; }

  .dpp-compound-arrow {
    color: var(--accent-dim);
    font-family: var(--font-mono);
  }

  .dpp-footer {
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .dpp-footer-links {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
  }

  .dpp-footer-link {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-tertiary);
    text-decoration: none;
    transition: color 80ms ease;
  }
  .dpp-footer-link:hover { color: var(--text-secondary); }

  .dpp-footer-note {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .dpp-toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(100px);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    padding: 8px 16px;
    border-radius: 2px;
    opacity: 0;
    transition: transform 120ms ease, opacity 120ms ease;
    z-index: 100;
    pointer-events: none;
  }
  .dpp-toast.show {
    transform: translateX(-50%) translateY(0);
    opacity: 1;
  }

  @media (max-width: 480px) {
    .dpp-nav-links { gap: 12px; }
    .dpp-nav-link { display: none; }
    .dpp-content { padding: 64px 16px 64px; }
    .dpp-profile-name { font-size: 18px; }
    .dpp-diff-header { padding: 10px 12px; }
    .dpp-diff-body-inner { padding-left: 28px; }
  }
`;

// ── Component ──────────────────────────────────────────────────────────────

export default function DaveProfilePage() {
  // Convex reactive state
  const me = useQuery('users:me');
  const myAdoptions = useQuery('adoptions:mine');
  const recordAdoption = useMutation('adoptions:record');

  // UI state
  const [openCards, setOpenCards] = useState(new Set(DIFFS.map((d) => d.slug)));
  const [filter, setFilter] = useState('all'); // 'all' | 'adopted' | 'notyet'
  const [expandedExplain, setExpandedExplain] = useState(new Set());
  const [shownMarkIt, setShownMarkIt] = useState(new Set());
  const [copiedBtns, setCopiedBtns] = useState(new Set()); // slugs or 'profile'
  const [toast, setToast] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef(null);

  // Derived adoption state
  const isLoggedIn = me !== undefined && me !== null;
  const isLoading = me === undefined;

  const adoptedSlugs = new Set(
    (myAdoptions || [])
      .filter((a) => !a.removed)
      .map((a) => a.diffSlug)
  );

  // ── Toast ────────────────────────────────────────────────────────────────

  const showToast = useCallback((message) => {
    setToast(message);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 2000);
  }, []);

  // ── Copy to clipboard ────────────────────────────────────────────────────

  const copyCommand = useCallback((cmd, btnKey) => {
    navigator.clipboard.writeText(cmd).then(() => {
      if (window.pendo) (window).pendo?.track('diff_command_copied', { command: cmd });

      showToast('Copied: ' + cmd);

      setCopiedBtns((prev) => new Set(prev).add(btnKey));
      setTimeout(() => {
        setCopiedBtns((prev) => {
          const next = new Set(prev);
          next.delete(btnKey);
          return next;
        });
      }, 2000);

      // Show "Mark it" row after copy (for per-diff adopt commands)
      setShownMarkIt((prev) => new Set(prev).add(btnKey));
    });
  }, [showToast]);

  // ── Toggle card open/close ───────────────────────────────────────────────

  const toggleCard = useCallback((slug) => {
    setOpenCards((prev) => {
      const next = new Set(prev);
      const wasOpen = next.has(slug);
      if (wasOpen) next.delete(slug); else next.add(slug);
      if (window.pendo) (window).pendo?.track(wasOpen ? 'diff_collapsed' : 'diff_expanded', { diffId: slug });
      return next;
    });
  }, []);

  // ── Toggle explain section ───────────────────────────────────────────────

  const toggleExplain = useCallback((slug) => {
    setExpandedExplain((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  }, []);

  // ── Mark as adopted ──────────────────────────────────────────────────────

  const handleMarkAdopted = useCallback(async (slug) => {
    try {
      await recordAdoption({ authorHandle: 'dave', diffSlug: slug });
      if (window.pendo) (window).pendo?.track('diff_marked_adopted', { diffId: slug });
      // myAdoptions updates reactively — no manual state needed
    } catch (err) {
      console.error('Failed to record adoption:', err);
    }
  }, [recordAdoption]);

  // ── Handle logout ────────────────────────────────────────────────────────

  const handleLogout = useCallback(() => {
    localStorage.removeItem('__convexAuthJWT');
    window.location.reload();
  }, []);

  // ── Visibility filter ────────────────────────────────────────────────────

  const isCardVisible = (slug) => {
    if (!isLoggedIn || filter === 'all') return true;
    if (filter === 'adopted') return adoptedSlugs.has(slug);
    if (filter === 'notyet') return !adoptedSlugs.has(slug);
    return true;
  };

  const returnPath = encodeURIComponent('/diff/@dave/');

  // ── Render adopt row per card ────────────────────────────────────────────

  const renderAdoptRow = (slug) => {
    if (isLoading) return null;

    if (!isLoggedIn) {
      return (
        <div className="dpp-diff-adopt-row">
          <a
            className="dpp-diff-adopt-cta"
            href={`/connect/?return=${returnPath}`}
          >
            <span className="dpp-diff-adopt-cmd-text">Register to adopt this workflow</span>
            <span className="dpp-diff-adopt-cmd-label">→</span>
          </a>
        </div>
      );
    }

    if (adoptedSlugs.has(slug)) {
      return (
        <div className="dpp-diff-adopt-row">
          <div className="dpp-diff-adopted-indicator">
            <span className="dpp-diff-adopted-check">✓</span>
            <span className="dpp-diff-adopted-text">Adopted</span>
          </div>
        </div>
      );
    }

    const cmd = `/diff-adopt @dave/${slug}`;
    const isCopied = copiedBtns.has(slug);
    const explainOpen = expandedExplain.has(slug);
    const markItVisible = shownMarkIt.has(slug);

    return (
      <div className="dpp-diff-adopt-row">
        <div
          className="dpp-diff-adopt-cmd"
          onClick={() => copyCommand(cmd, slug)}
        >
          <span className="dpp-diff-adopt-cmd-text">{cmd}</span>
          <span className="dpp-diff-adopt-cmd-label">{isCopied ? 'Copied' : 'Copy'}</span>
        </div>

        <div className="dpp-diff-adopt-explain">
          <button
            className="dpp-diff-adopt-toggle"
            onClick={() => toggleExplain(slug)}
            type="button"
          >
            What happens when I paste this?{' '}
            <i className={`dpp-diff-adopt-chevron${explainOpen ? ' open' : ''}`}>▶</i>
          </button>
          <div className={`dpp-diff-adopt-detail${explainOpen ? ' open' : ''}`}>
            <ol className="dpp-diff-adopt-steps">
              {ADOPT_STEPS.map((step) => (
                <li key={step.label}>
                  <strong>{step.label}</strong> — {step.body}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {markItVisible && (
          <div className="dpp-diff-mark-adopted">
            Already adopted this?{' '}
            <button
              className="dpp-diff-mark-link"
              type="button"
              onClick={() => handleMarkAdopted(slug)}
            >
              Mark it
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── Render profile adopt box ─────────────────────────────────────────────

  const renderProfileAdoptBox = () => {
    if (isLoading) return null;

    if (!isLoggedIn) {
      return (
        <div className="dpp-profile-adopt-box">
          <a
            className="dpp-diff-adopt-cta"
            href={`/connect/?return=${returnPath}`}
            style={{ display: 'inline-flex', padding: '8px 12px', marginBottom: '8px' }}
          >
            <span className="dpp-diff-adopt-cmd-text" style={{ fontSize: '13px' }}>
              Register to adopt all 7 workflows →
            </span>
          </a>
        </div>
      );
    }

    const profileCmd = '/diff-adopt-profile @dave';
    const isCopied = copiedBtns.has('profile');

    return (
      <div className="dpp-profile-adopt-box">
        <div
          className="dpp-adopt-command"
          onClick={() => copyCommand(profileCmd, 'profile')}
        >
          <span className="dpp-adopt-command-text">{profileCmd}</span>
          <span className="dpp-adopt-command-btn">{isCopied ? 'Copied' : 'Copy'}</span>
        </div>
      </div>
    );
  };

  // ── Nav auth section ─────────────────────────────────────────────────────

  const renderNavAuth = () => {
    if (isLoggedIn && me?.handle) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="dpp-auth-handle">@{me.handle}</span>
          <button className="dpp-auth-logout" onClick={handleLogout} type="button">
            Log out
          </button>
        </div>
      );
    }
    return (
      <a href={`/connect/?return=${returnPath}`} className="dpp-nav-cta">
        Get Dexed Up
      </a>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />

      {/* Fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@300;400;500;600&family=Geist:wght@300;400;500;600&display=swap"
        rel="stylesheet"
      />

      {/* NAV */}
      <nav className="dpp-nav" aria-label="Main navigation">
        <div className="dpp-nav-inner">
          <a href="/diff/" className="dpp-nav-logo">◆ dexdiff</a>
          <div className="dpp-nav-links">
            <a href="/diff/community/" className="dpp-nav-link">Community</a>
            <a href="/diff/company/" className="dpp-nav-link">Your Company</a>
            <a href="/diff/love-letters/" className="dpp-nav-link">Love Letters</a>
            {renderNavAuth()}
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main className="dpp-content">

        {/* PROFILE HEADER */}
        <header className="dpp-profile-header">
          <h1 className="dpp-profile-name">Dave Killeen</h1>
          <div className="dpp-profile-role">Field CPO, EMEA</div>
          <div className="dpp-profile-quote">
            Every interaction compounds into the next one. After 3 months, my Dex knows more about my professional relationships than I do — and it surfaces things I'd miss on my own.
          </div>
          <div className="dpp-profile-intro">
            <p>
              Dex ships with standard capabilities — meeting prep, daily planning, weekly reviews. What you're looking at below is what I've built{' '}
              <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>on top</strong>{' '}
              of that baseline. Seven workflows specific to how I work as a Field CPO across 30+ enterprise deals in EMEA.
            </p>
            <p>
              If any of these resonate, copy the adopt command and paste it in your terminal. Your Dex reads the methodology, asks you a few questions, and generates a version tailored to your vault. Nothing from my system gets copied into yours.
            </p>
          </div>

          {/* PROFILE ADOPT BOX */}
          {renderProfileAdoptBox()}
          <div className="dpp-adopt-command-hint">Copy this command and paste it into Dex to adopt all 7 workflows</div>
          <div className="dpp-install-hint">
            Don't have Dex yet?{' '}
            <a href="https://heydex.ai" target="_blank" rel="noopener noreferrer">
              Install Dex first →
            </a>
          </div>
        </header>

        <hr className="dpp-divider" />

        {/* SECTION HEADER + FILTER */}
        <div className="dpp-filter-row">
          <div className="dpp-section-label" style={{ marginBottom: 0 }}>7 Workflows</div>
          {isLoggedIn && (
            <div className="dpp-diff-filter">
              <span className="dpp-filter-label">Show</span>
              <button
                className={`dpp-filter-btn${filter === 'all' ? ' active' : ''}`}
                onClick={() => setFilter('all')}
                type="button"
              >
                All
              </button>
              <button
                className={`dpp-filter-btn${filter === 'adopted' ? ' active' : ''}`}
                onClick={() => setFilter('adopted')}
                type="button"
              >
                Adopted ✓
              </button>
              <button
                className={`dpp-filter-btn${filter === 'notyet' ? ' active' : ''}`}
                onClick={() => setFilter('notyet')}
                type="button"
              >
                Not yet
              </button>
            </div>
          )}
        </div>

        {/* DIFF LIST */}
        <div className="dpp-diff-list">
          {DIFFS.map((diff) => {
            if (!isCardVisible(diff.slug)) return null;
            const isOpen = openCards.has(diff.slug);

            return (
              <div
                key={diff.slug}
                className="dpp-diff-card"
                id={diff.slug}
                data-diff={diff.slug}
              >
                <button
                  className="dpp-diff-header"
                  onClick={() => toggleCard(diff.slug)}
                  aria-expanded={isOpen}
                  aria-controls={`diff-body-${diff.slug}`}
                  type="button"
                >
                  <span className={`dpp-diff-expand${isOpen ? ' open' : ''}`} aria-hidden="true">▶</span>
                  <span className="dpp-diff-title">{diff.title}</span>
                  <span className="dpp-diff-tagline">{diff.tagline}</span>
                </button>

                <div
                  className={`dpp-diff-body${isOpen ? ' open' : ''}`}
                  id={`diff-body-${diff.slug}`}
                >
                  <div className="dpp-diff-body-inner">
                    <div className="dpp-diff-section-label">Problem</div>
                    <p className="dpp-diff-problem">{diff.problem}</p>

                    <div className="dpp-diff-section-label">What this does</div>
                    <p className="dpp-diff-solution">{diff.solution}</p>

                    <div className="dpp-diff-section-label">Baseline vs Added</div>
                    <p className="dpp-diff-baseline">{diff.baseline}</p>
                    <p className="dpp-diff-adds">{diff.adds}</p>

                    <div className="dpp-diff-section-label">Commands</div>
                    <div className="dpp-diff-commands">
                      {diff.commands.map((cmd) => (
                        <div key={cmd.name} className="dpp-diff-cmd">
                          <span className="dpp-diff-cmd-name">{cmd.name}</span>
                          <span className="dpp-diff-cmd-desc">{cmd.desc}</span>
                        </div>
                      ))}
                    </div>

                    {renderAdoptRow(diff.slug)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* COMPOUND LOOPS */}
        <div className="dpp-compound-section">
          <hr className="dpp-divider" />
          <div className="dpp-section-label">Compound Loops</div>
          <p className="dpp-diff-solution" style={{ marginBottom: '12px' }}>
            These workflows form feedback loops — each one makes the others stronger.
          </p>
          <ul className="dpp-compound-loop">
            <li>
              <span className="dpp-compound-arrow">→</span>{' '}
              Meetings feed relationships feed meetings. Every meeting note updates person pages. Every person page enriches the next prep.
            </li>
            <li>
              <span className="dpp-compound-arrow">→</span>{' '}
              Deals feed planning feed accountability. Deal intel surfaces what needs attention. Planning prioritises it. Cracks detection catches when it slips.
            </li>
            <li>
              <span className="dpp-compound-arrow">→</span>{' '}
              Sessions feed learning feed sessions. Every correction teaches the system. Every pattern becomes a guard rail.
            </li>
          </ul>
        </div>

        {/* FOOTER */}
        <footer className="dpp-footer">
          <div className="dpp-footer-links">
            <a href="https://heydex.ai" className="dpp-footer-link">Get Dex</a>
            <a href="/diff/community/" className="dpp-footer-link">Community</a>
            <a href="https://github.com/davekilleen/dex" className="dpp-footer-link">GitHub</a>
            <a href="/privacy/" className="dpp-footer-link">Privacy</a>
          </div>
          <div className="dpp-footer-note">Your data never leaves your machine</div>
        </footer>

      </main>

      {/* TOAST */}
      <div className={`dpp-toast${toastVisible ? ' show' : ''}`}>{toast}</div>
    </>
  );
}

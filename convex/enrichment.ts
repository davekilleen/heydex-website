import { v } from "convex/values";
import { action } from "./_generated/server";

// ── URL helpers ──────────────────────────────────────────────────────

const LINKEDIN_PROFILE_RE = /linkedin\.com\/in\/([a-zA-Z0-9\-]{3,59})\/?/;
const LINKEDIN_NON_PROFILE_RE =
  /linkedin\.com\/(company|school|groups|pub|posts)\//;
const BARE_USERNAME_RE = /^[a-zA-Z0-9\-]{3,59}$/;

function normalizeLinkedInUrl(raw: string): {
  url: string;
  username: string;
} {
  // Strip protocol
  let cleaned = raw.trim().replace(/^https?:\/\//, "");

  // Reject company / school / group pages
  if (LINKEDIN_NON_PROFILE_RE.test(raw) || LINKEDIN_NON_PROFILE_RE.test(cleaned)) {
    throw new Error(
      "Only personal LinkedIn profiles (linkedin.com/in/…) are supported. Company, school, and group pages cannot be enriched."
    );
  }

  // Already a linkedin.com/in/ URL
  const profileMatch = cleaned.match(LINKEDIN_PROFILE_RE);
  if (profileMatch) {
    const username = profileMatch[1];
    // Rebuild a canonical URL
    return {
      url: `https://www.linkedin.com/in/${username}`,
      username,
    };
  }

  // Bare username
  if (BARE_USERNAME_RE.test(cleaned)) {
    return {
      url: `https://www.linkedin.com/in/${cleaned}`,
      username: cleaned,
    };
  }

  throw new Error(
    `Could not parse "${raw}" as a LinkedIn profile URL or username.`
  );
}

function formatUsername(username: string): string {
  return username
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Exa API call ─────────────────────────────────────────────────────

const SUMMARY_PROMPT = `Extract the following fields from this LinkedIn profile. Return each on its own line in exactly this format:

Name: <full name>
Title: <current job title>
Company: <current company>
Industry: <industry>
Function: <one of: product, sales, eng, marketing, design, cs, founder, other>
Seniority: <one of: ic, manager, director, vp, c-level, founder>
PhotoUrl: <profile photo URL if available, or "none">
Summary: <3-5 sentence third-person professional summary>`;

interface ExaResult {
  url: string;
  title?: string;
  text?: string;
  author?: string;
  summary?: string;
  highlights?: string[];
}

interface ExaResponse {
  results: ExaResult[];
}

async function callExa(url: string): Promise<ExaResult | null> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error("EXA_API_KEY environment variable is not set.");
  }

  const resp = await fetch("https://api.exa.ai/contents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      urls: [url],
      text: true,
      summary: { query: SUMMARY_PROMPT },
      highlights: { numSentences: 3, highlightsPerUrl: 2 },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Exa API error ${resp.status}: ${body}`);
  }

  const data: ExaResponse = await resp.json();
  return data.results?.[0] ?? null;
}

// ── Response parsing ─────────────────────────────────────────────────

const VALID_FUNCTIONS = [
  "product",
  "sales",
  "eng",
  "marketing",
  "design",
  "cs",
  "founder",
  "other",
] as const;

const VALID_SENIORITIES = [
  "ic",
  "manager",
  "director",
  "vp",
  "c-level",
  "founder",
] as const;

function extractField(text: string, field: string): string | undefined {
  const re = new RegExp(`^${field}:\\s*(.+)$`, "im");
  const m = text.match(re);
  return m?.[1]?.trim() || undefined;
}

function normalizeEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[]
): T | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase().trim();
  return (allowed as readonly string[]).includes(lower)
    ? (lower as T)
    : undefined;
}

function cleanTitle(title: string | undefined, company: string | undefined): string | undefined {
  if (!title) return undefined;
  if (company) {
    // Remove trailing " at Company" or " @ Company"
    const suffixRe = new RegExp(`\\s+(?:at|@)\\s+${escapeRegex(company)}$`, "i");
    title = title.replace(suffixRe, "").trim();
  }
  return title || undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fallback: parse "Name — Title at Company" from page title */
function parsePageTitle(pageTitle: string): {
  name?: string;
  title?: string;
  company?: string;
} {
  // Common patterns:
  //   "Jane Doe - Senior PM at Acme | LinkedIn"
  //   "Jane Doe — Senior PM at Acme | LinkedIn"
  const cleaned = pageTitle.replace(/\s*[|–—]\s*LinkedIn\s*$/i, "").trim();
  const sep = cleaned.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (!sep) return { name: cleaned || undefined };

  const name = sep[1].trim();
  const rest = sep[2].trim();

  const atMatch = rest.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (atMatch) {
    return { name, title: atMatch[1].trim(), company: atMatch[2].trim() };
  }
  return { name, title: rest || undefined };
}

/** Try to pull a name from the first line of raw text */
function nameFromText(text: string): string | undefined {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0);
  if (!firstLine) return undefined;
  const words = firstLine.trim().split(/\s+/);
  // Heuristic: a name is 2-4 short capitalized words at the start
  if (words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Z]/.test(w))) {
    return words.join(" ");
  }
  return undefined;
}

// ── Enrichment result type ───────────────────────────────────────────

interface EnrichmentResult {
  name: string;
  title?: string;
  company?: string;
  industry?: string;
  function_?: string;
  seniority?: string;
  summary?: string;
  photoUrl?: string;
  linkedinUrl: string;
  warning?: string;
}

// ── Exported action ──────────────────────────────────────────────────

export const enrichProfile = action({
  args: { linkedinUrl: v.string() },
  handler: async (_ctx, args): Promise<EnrichmentResult> => {
    const { url: normalizedUrl, username } = normalizeLinkedInUrl(
      args.linkedinUrl
    );
    const fallbackName = formatUsername(username);

    let result: ExaResult | null;
    try {
      result = await callExa(normalizedUrl);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        name: fallbackName,
        linkedinUrl: normalizedUrl,
        warning: `Could not enrich profile: ${msg}`,
      };
    }

    // Private or missing profile
    if (!result || (!result.summary && !result.text && !result.author)) {
      return {
        name: fallbackName,
        linkedinUrl: normalizedUrl,
        warning:
          "Profile appears to be private or could not be retrieved. Only the username is available.",
      };
    }

    // ── Parse structured fields from AI summary ──
    const summaryText = result.summary ?? "";
    let name = extractField(summaryText, "Name");
    let title = extractField(summaryText, "Title");
    let company = extractField(summaryText, "Company");
    const industry = extractField(summaryText, "Industry");
    const function_ = normalizeEnum(
      extractField(summaryText, "Function"),
      VALID_FUNCTIONS
    );
    const seniority = normalizeEnum(
      extractField(summaryText, "Seniority"),
      VALID_SENIORITIES
    );
    const summary = extractField(summaryText, "Summary");
    const rawPhotoUrl = extractField(summaryText, "PhotoUrl");
    const photoUrl =
      rawPhotoUrl && rawPhotoUrl.toLowerCase() !== "none" && rawPhotoUrl.startsWith("http")
        ? rawPhotoUrl
        : undefined;

    // author field is the most reliable name source from Exa
    if (result.author) {
      name = result.author;
    }

    // Fallback: parse page title
    if (!name || !title) {
      const fromTitle = parsePageTitle(result.title ?? "");
      if (!name && fromTitle.name) name = fromTitle.name;
      if (!title && fromTitle.title) title = fromTitle.title;
      if (!company && fromTitle.company) company = fromTitle.company;
    }

    // Fallback: extract name from raw text
    if (!name && result.text) {
      name = nameFromText(result.text);
    }

    // Ultimate fallback
    if (!name) {
      name = fallbackName;
    }

    title = cleanTitle(title, company);

    return {
      name,
      title: title || undefined,
      company: company || undefined,
      industry: industry || undefined,
      function_: function_ || undefined,
      seniority: seniority || undefined,
      summary: summary || undefined,
      photoUrl,
      linkedinUrl: normalizedUrl,
    };
  },
});

// Client-side counterpart to the Python script's trigger_async_job() / poll_job_status() /
// download_snapshot_results() / process_verification_results(). The three network calls now
// go to this project's own /api/linkedin/* serverless functions (same origin, so no CORS
// issue either) instead of directly to Bright Data — see those files for why.
//
// One behavior is deliberately changed, not just ported: the Python script checked every
// profile against a single hardcoded TARGET_COMPANY constant. A CSV of contacts spans many
// different companies, so here each row is checked against *its own* "Account Name" value
// instead — does this contact's LinkedIn profile currently show them at the company already
// on file for them, rather than one company for the whole file.

import { withStatusColumn } from "./dataQuality.js";

const POLL_INTERVAL_MS = 8000;

export const LINKEDIN_STATUS_HEADER = "LinkedIn Employment Status";
export const LINKEDIN_COMPANY_HEADER = "LinkedIn Current Company";
export const LINKEDIN_TITLE_HEADER = "LinkedIn Current Title";

// ---------------------------------------------------------------------------
// URL handling
// ---------------------------------------------------------------------------

/** Normalizes a LinkedIn profile URL to a stable lowercase key for matching results back to rows. */
export function normalizeLinkedInUrl(raw) {
  if (!raw) return null;
  let value = String(raw).trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (host !== "linkedin.com") return null;

  const path = parsed.pathname.replace(/\/+$/, "");
  if (!path) return null;

  return `https://www.linkedin.com${path}`.toLowerCase();
}

// ---------------------------------------------------------------------------
// Server calls — thin wrappers around this project's own /api/linkedin/* endpoints
// ---------------------------------------------------------------------------

async function readJsonOrThrow(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export async function triggerVerification(urls) {
  const response = await fetch("/api/linkedin/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls })
  });
  const data = await readJsonOrThrow(response);
  return data.snapshotId;
}

/** Polls until the job is ready, calling onProgress(data) after every check. Throws on failed/canceled. */
export async function pollVerificationStatus(snapshotId, onProgress) {
  for (;;) {
    const response = await fetch(`/api/linkedin/status?id=${encodeURIComponent(snapshotId)}`);
    const data = await readJsonOrThrow(response);

    if (onProgress) onProgress(data);

    if (data.status === "ready") return;
    if (data.status === "failed" || data.status === "canceled") {
      throw new Error(`Bright Data job ended with status "${data.status}".`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export async function fetchVerificationResults(snapshotId) {
  const response = await fetch(`/api/linkedin/results?id=${encodeURIComponent(snapshotId)}`);
  const data = await readJsonOrThrow(response);
  return Array.isArray(data) ? data : [];
}

// ---------------------------------------------------------------------------
// Per-row matching — ported from process_verification_results()
// ---------------------------------------------------------------------------

/**
 * Checks one scraped profile against one row's expected employer.
 * Mirrors the Python function's two-step detection: prefer an experience-history entry for
 * the target company with no end date (or "present"), falling back to the profile's
 * `current_company` field, then the headline for a title if nothing more specific matched.
 */
export function matchProfileToAccount(profile, accountName) {
  const targetOrg = String(accountName || "").trim();
  if (!profile || !targetOrg) {
    return { status: "Missing Data", company: profile?.current_company?.name || "", title: "" };
  }

  const headline = profile.headline || "";
  let currCompany = profile.current_company?.name || "";
  let detectedTitle = "";
  let matchedInExperience = false;

  for (const exp of profile.experience || []) {
    const companyName = exp.company || "";
    const endDate = String(exp.end_date ?? "").trim().toLowerCase();
    const isCurrent = endDate === "" || endDate.includes("present");
    if (isCurrent && companyName.toLowerCase().includes(targetOrg.toLowerCase())) {
      matchedInExperience = true;
      detectedTitle = exp.title || headline;
      if (!currCompany) currCompany = companyName;
      break;
    }
  }

  const companyMatches = Boolean(currCompany) && currCompany.toLowerCase().includes(targetOrg.toLowerCase());
  if (companyMatches && !detectedTitle) detectedTitle = headline;

  const isEmployed = companyMatches || matchedInExperience;

  return {
    status: isEmployed ? "Matched" : "Not Matched",
    company: currCompany,
    title: isEmployed ? detectedTitle : ""
  };
}

/** Builds a normalized-URL -> profile lookup from Bright Data's result array. */
export function buildProfileLookup(results) {
  const map = new Map();
  results.forEach((profile) => {
    const key = normalizeLinkedInUrl(profile.url || profile.input?.url);
    if (key) map.set(key, profile);
  });
  return map;
}

/**
 * Applies verification results to every row, appending/updating the three LinkedIn
 * columns the same append-or-update-in-place way the rest of this project's status columns
 * work (see withStatusColumn in dataQuality.js).
 */
export function applyVerificationResults(headers, rows, linkedinHeader, accountHeader, profileLookup) {
  const statuses = [];
  const companies = [];
  const titles = [];

  rows.forEach((row) => {
    const key = normalizeLinkedInUrl(row[linkedinHeader]);
    if (!key) {
      statuses.push("Missing Data");
      companies.push("");
      titles.push("");
      return;
    }
    const profile = profileLookup.get(key);
    const result = matchProfileToAccount(profile, row[accountHeader]);
    statuses.push(result.status);
    companies.push(result.company);
    titles.push(result.title);
  });

  let headersOut = headers;
  let rowsOut = rows;
  ({ headers: headersOut, rows: rowsOut } = withStatusColumn(headersOut, rowsOut, LINKEDIN_STATUS_HEADER, statuses));
  ({ headers: headersOut, rows: rowsOut } = withStatusColumn(headersOut, rowsOut, LINKEDIN_COMPANY_HEADER, companies));
  ({ headers: headersOut, rows: rowsOut } = withStatusColumn(headersOut, rowsOut, LINKEDIN_TITLE_HEADER, titles));

  const stats = { matched: 0, notMatched: 0, missing: 0 };
  statuses.forEach((s) => {
    if (s === "Matched") stats.matched += 1;
    else if (s === "Not Matched") stats.notMatched += 1;
    else stats.missing += 1;
  });

  return { headers: headersOut, rows: rowsOut, stats };
}

// ---------------------------------------------------------------------------
// Full orchestration
// ---------------------------------------------------------------------------

/** Every row's LinkedIn URL, deduplicated and normalized — what actually gets sent to Bright Data. */
export function collectUniqueUrls(rows, linkedinHeader) {
  const set = new Set();
  rows.forEach((row) => {
    const key = normalizeLinkedInUrl(row[linkedinHeader]);
    if (key) set.add(key);
  });
  return [...set];
}

/**
 * Runs the full trigger -> poll -> download -> match pipeline.
 * @param callbacks.onStatusUpdate  called with { status, progress } on every poll
 */
export async function runLinkedInVerification(headers, rows, { linkedinHeader, accountHeader }, callbacks = {}) {
  const uniqueUrls = collectUniqueUrls(rows, linkedinHeader);
  if (!uniqueUrls.length) {
    throw new Error(`No valid linkedin.com profile URLs were found in the "${linkedinHeader}" column.`);
  }

  const snapshotId = await triggerVerification(uniqueUrls);
  await pollVerificationStatus(snapshotId, callbacks.onStatusUpdate);
  const results = await fetchVerificationResults(snapshotId);
  const profileLookup = buildProfileLookup(results);

  const { headers: nextHeaders, rows: nextRows, stats } = applyVerificationResults(
    headers,
    rows,
    linkedinHeader,
    accountHeader,
    profileLookup
  );

  return {
    headers: nextHeaders,
    rows: nextRows,
    stats,
    snapshotId,
    uniqueUrlCount: uniqueUrls.length,
    resultCount: results.length
  };
}

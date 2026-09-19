// Ported from two Apps Script functions — matchWebsiteAndEmailDomain() and
// markDuplicateEmails(). Both did the same kind of thing: compute a status per row and write
// it into a column found by header name (or appended if it didn't exist yet), independent of
// column order. Here that becomes: compute a status per row, then splice it into the
// uploaded CSV's headers/rows the same way — update the column in place if it's already
// there, append it at the end if it isn't.

export const DOMAIN_MATCH_HEADER = "Domain Match Status";
export const DUPLICATE_STATUS_HEADER = "Duplicate Status";

// ---------------------------------------------------------------------------
// matchWebsiteAndEmailDomain()
// ---------------------------------------------------------------------------

/** Verbatim port of extractWebsiteDomain(). */
export function extractWebsiteDomain(url) {
  if (!url) return null;
  try {
    const domain = String(url)
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
    return domain || null;
  } catch {
    return null;
  }
}

/** Verbatim port of extractEmailDomain(). */
export function extractEmailDomain(email) {
  if (!email) return null;
  try {
    const parts = String(email).toLowerCase().split("@");
    return parts.length === 2 ? parts[1].trim() : null;
  } catch {
    return null;
  }
}

/** "Matched" | "Not Matched" | "Missing Data" — same three outcomes as the original loop body. */
export function computeDomainMatchStatus(website, email) {
  if (!website || !email) return "Missing Data";

  const websiteDomain = extractWebsiteDomain(website);
  const emailDomain = extractEmailDomain(email);
  if (!websiteDomain || !emailDomain) return "Missing Data";

  return websiteDomain === emailDomain ? "Matched" : "Not Matched";
}

/**
 * @param rows            array of row objects keyed by CSV header
 * @param websiteHeader   header holding the Website value
 * @param emailHeader     header holding the Email Address value
 * @returns { statuses: string[], stats }  one status per row, in order
 */
export function runDomainMatchCheck(rows, websiteHeader, emailHeader) {
  const stats = { matched: 0, notMatched: 0, missing: 0 };

  const statuses = rows.map((row) => {
    const status = computeDomainMatchStatus(row[websiteHeader], row[emailHeader]);
    if (status === "Matched") stats.matched += 1;
    else if (status === "Not Matched") stats.notMatched += 1;
    else stats.missing += 1;
    return status;
  });

  return { statuses, stats };
}

// ---------------------------------------------------------------------------
// markDuplicateEmails()
// ---------------------------------------------------------------------------

/**
 * @param rows          array of row objects keyed by CSV header
 * @param emailHeader   header holding the Email Address value
 * @returns { statuses: string[], stats }  "Duplicate" | "Unique" | "Missing Email" per row,
 *   using the same lowercase-trimmed comparison and two-pass count-then-flag approach as the
 *   original (count every occurrence first, then flag each row against that count).
 */
export function runDuplicateEmailCheck(rows, emailHeader) {
  const counts = {};
  rows.forEach((row) => {
    const raw = row[emailHeader];
    if (raw) {
      const email = String(raw).toLowerCase().trim();
      counts[email] = (counts[email] || 0) + 1;
    }
  });

  const stats = { duplicate: 0, unique: 0, missing: 0 };

  const statuses = rows.map((row) => {
    const raw = row[emailHeader];
    if (!raw) {
      stats.missing += 1;
      return "Missing Email";
    }
    const email = String(raw).toLowerCase().trim();
    if (counts[email] > 1) {
      stats.duplicate += 1;
      return "Duplicate";
    }
    stats.unique += 1;
    return "Unique";
  });

  return { statuses, stats };
}

// ---------------------------------------------------------------------------
// Splicing a status column into headers/rows — the append-or-update-in-place
// behavior both original functions applied to the live sheet
// ---------------------------------------------------------------------------

/**
 * Writes `statuses` into `headerName`, updating that column in place if the uploaded file
 * already had it, or appending it as a new last column if it didn't — same as
 * `headerMap[...] ?? headers.length` in both original functions.
 */
export function withStatusColumn(headers, rows, headerName, statuses) {
  const exists = headers.includes(headerName);
  const nextHeaders = exists ? headers : [...headers, headerName];
  const nextRows = rows.map((row, i) => ({ ...row, [headerName]: statuses[i] }));
  return { headers: nextHeaders, rows: nextRows };
}

/** Which XLSX/CSS status color a given status value should render with. */
export function statusColorKey(status) {
  if (status === "Matched" || status === "Unique") return "good";
  if (status === "Not Matched" || status === "Duplicate") return "bad";
  return "neutral"; // "Missing Data" | "Missing Email"
}

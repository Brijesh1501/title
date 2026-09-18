// Ported from two Apps Script functions — highlightLatestByCreatedDate() and
// highlightLatestCampaign(). Both did the same thing (group rows by Website, find the
// row(s) with the latest date within each group, paint them yellow) but read the date from
// two different places: a "Created Date" column, or parsed out of a "Campaign Name" string.
// That's unified here as one "mode" switch instead of two near-duplicate functions.

/** Same Website normalization both original functions used, verbatim. */
export function normalizeWebsite(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Mode: "created_date" — port of highlightLatestByCreatedDate()'s date parsing
// ---------------------------------------------------------------------------

/**
 * The original script only ever handled a real Date object (from a spreadsheet cell) or a
 * DD/MM/YYYY-shaped string, with the day/month order hardcoded. A CSV export has no Date
 * objects and the day/month order varies by source system, so that order is now a parameter
 * instead of an assumption — `dateFormat` is "dmy" (DD/MM/YYYY, the original's assumption) or
 * "mdy" (MM/DD/YYYY).
 *
 * A leading 4-digit part (e.g. "2024-05-21") is always read as YYYY-MM-DD regardless of
 * `dateFormat`, since that ordering isn't ambiguous. Anything that isn't a clean 3-part
 * numeric date falls back to the browser's native date parser (handles ISO timestamps,
 * "May 21, 2024", etc.) rather than being discarded outright.
 */
export function parseCreatedDate(raw, dateFormat = "dmy") {
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isNaN(t) ? null : t;
  }

  const str = String(raw ?? "").trim();
  if (!str) return null;

  const parts = str.split(/[/\-.]/).map((p) => p.trim());

  if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
    const [a, b, c] = parts;
    let day, month, year;

    if (a.length === 4) {
      // YYYY-MM-DD / YYYY/MM/DD — unambiguous, ignore the chosen format.
      year = parseInt(a, 10);
      month = parseInt(b, 10) - 1;
      day = parseInt(c, 10);
    } else {
      year = parseInt(c, 10);
      if (c.length === 2) year += 2000;
      if (dateFormat === "mdy") {
        month = parseInt(a, 10) - 1;
        day = parseInt(b, 10);
      } else {
        day = parseInt(a, 10);
        month = parseInt(b, 10) - 1;
      }
    }

    const time = new Date(year, month, day).getTime();
    return Number.isNaN(time) ? null : time;
  }

  const fallback = Date.parse(str);
  return Number.isNaN(fallback) ? null : fallback;
}

// ---------------------------------------------------------------------------
// Mode: "campaign_name" — port of highlightLatestCampaign(), unchanged logic
// ---------------------------------------------------------------------------

const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11
};

const MONTH_REGEX =
  /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)/i;

const DAY_REGEX =
  /\b(\d{1,2})[\s-]+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)/i;

const FY_REGEX = /\b(\d{2})-(\d{2})\b/g;

/**
 * Reads a fiscal-year-style campaign name like "Q3 FY 25-26 Mar Outbound" the same way the
 * original script did: last "XX-XX" pair in the string is the fiscal year (so a target range
 * like "(30-50)" earlier in the name doesn't get mistaken for it), month name picks the
 * month, an optional day number right before the month name is the day (default 1), and
 * Jan/Feb/Mar roll into the *second* year of the FY pair while every other month uses the
 * first year.
 */
export function parseCampaignDate(rawCampaign) {
  const campaign = String(rawCampaign ?? "").trim();
  if (!campaign) return null;

  const monthMatch = campaign.match(MONTH_REGEX);
  if (!monthMatch) return null;

  const fyMatches = [...campaign.matchAll(FY_REGEX)];
  if (fyMatches.length === 0) return null;
  const fyMatch = fyMatches[fyMatches.length - 1];

  const month = MONTHS[monthMatch[1].toLowerCase()];
  const dayMatch = campaign.match(DAY_REGEX);
  const day = dayMatch ? parseInt(dayMatch[1], 10) : 1;

  const startYear = parseInt(fyMatch[1], 10);
  const endYear = parseInt(fyMatch[2], 10);
  const year = (month <= 2 ? endYear : startYear) + 2000;

  const time = new Date(year, month, day).getTime();
  return Number.isNaN(time) ? null : time;
}

// ---------------------------------------------------------------------------
// Shared grouping/highlighting pass
// ---------------------------------------------------------------------------

/**
 * @param rows            array of row objects keyed by CSV header
 * @param options.websiteHeader   header holding the Website value to group by
 * @param options.mode            "created_date" | "campaign_name"
 * @param options.dateHeader      header holding the date (mode: "created_date")
 * @param options.dateFormat      "dmy" | "mdy" (mode: "created_date")
 * @param options.campaignHeader  header holding the campaign name (mode: "campaign_name")
 *
 * @returns { latestRowIndexes: Set<number>, stats }
 *   latestRowIndexes holds the indexes (into `rows`) of every row that is the latest — or
 *   tied for latest — within its Website group, i.e. exactly the rows the original script
 *   painted yellow. Rows with a blank Website or an unparseable date are left out of both
 *   the grouping and the highlight, same as the original's `continue` on either case.
 */
export function computeLatestRows(rows, options) {
  const { websiteHeader, mode, dateHeader, dateFormat, campaignHeader } = options;

  const groups = new Map();
  let skippedNoWebsite = 0;
  let skippedNoDate = 0;

  rows.forEach((row, index) => {
    const website = normalizeWebsite(row[websiteHeader]);
    if (!website) {
      skippedNoWebsite += 1;
      return;
    }

    const value =
      mode === "campaign_name"
        ? parseCampaignDate(row[campaignHeader])
        : parseCreatedDate(row[dateHeader], dateFormat);

    if (value === null) {
      skippedNoDate += 1;
      return;
    }

    if (!groups.has(website)) groups.set(website, []);
    groups.get(website).push({ index, value });
  });

  const latestRowIndexes = new Set();
  groups.forEach((entries) => {
    const maxValue = entries.reduce((max, e) => (e.value > max ? e.value : max), -Infinity);
    entries.forEach((e) => {
      if (e.value === maxValue) latestRowIndexes.add(e.index);
    });
  });

  return {
    latestRowIndexes,
    stats: {
      totalRows: rows.length,
      websiteGroups: groups.size,
      highlightedRows: latestRowIndexes.size,
      skippedNoWebsite,
      skippedNoDate
    }
  };
}

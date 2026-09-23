// Ported 1:1 from the original Google Apps Script (normalizeUSPhone / formatUSNumber).
// Recognizes common US phone formats:
//   (408) 368-1105
//   +12129280800
//   1-860-558-5857
//   1 801-358-3285
//   +1 650-714-3286

const PHONE_REGEX =
  /(^|[^\d])((?:\+?1[\s.-]*)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4})(?=$|[^\d])/g;

export function formatUSNumber(digits) {
  return "+1 " + digits.substring(0, 3) + "-" + digits.substring(3, 6) + "-" + digits.substring(6, 10);
}

export function normalizeUSPhone(value) {
  if (!value) return value;
  const original = String(value);

  return original.replace(PHONE_REGEX, (match, before, phone) => {
    const digits = phone.replace(/\D/g, "");
    let nationalNumber;

    if (/^\d{10}$/.test(digits)) {
      nationalNumber = digits;
    } else if (/^1\d{10}$/.test(digits)) {
      nationalNumber = digits.substring(1);
    } else {
      return match;
    }

    return before + formatUSNumber(nationalNumber);
  });
}

// Header names the tool looks for in an uploaded CSV (case-insensitive,
// matches the Apps Script's phoneHeaders array).
export const PHONE_HEADER_CANDIDATES = ["mobile no.", "direct no."];

/**
 * Runs normalizeUSPhone over every cell in the matching columns of parsed
 * CSV rows (array of plain objects, one per row, keyed by header).
 * Returns { rows, changedCount, matchedHeaders }.
 */
export function normalizePhoneRows(rows, headerCandidates = PHONE_HEADER_CANDIDATES) {
  if (!rows.length) return { rows, changedCount: 0, matchedHeaders: [] };

  const actualHeaders = Object.keys(rows[0]);
  const matchedHeaders = actualHeaders.filter((h) =>
    headerCandidates.includes(h.trim().toLowerCase())
  );

  let changedCount = 0;

  const nextRows = rows.map((row) => {
    const next = { ...row };
    matchedHeaders.forEach((header) => {
      const before = next[header];
      const after = normalizeUSPhone(before);
      if (after !== before) changedCount += 1;
      next[header] = after;
    });
    return next;
  });

  return { rows: nextRows, changedCount, matchedHeaders };
}

// ---------------------------------------------------------------------------
// Admin-editable version — headers to scan and number patterns to recognize both come from
// Supabase (phone_header_rules / phone_number_patterns) instead of the hardcoded
// PHONE_HEADER_CANDIDATES / PHONE_REGEX above. Those two stay exactly as they were so any
// existing caller (the Complete Pipeline's phone-format step included) keeps working
// unchanged; this section is additive, used only where a page opts into it.

import { supabase } from "../supabaseClient.js";

export async function fetchPhoneHeaderRules() {
  const { data, error } = await supabase
    .from("phone_header_rules")
    .select("*")
    .eq("is_active", true)
    .order("header_name", { ascending: true });

  if (error) throw error;
  return data;
}

export async function fetchPhonePatternRules() {
  const { data, error } = await supabase
    .from("phone_number_patterns")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * Compiles one phone_number_patterns row into a ready-to-use matcher. The regex is *built*
 * from the rule's plain fields (country code + digit grouping) rather than admin-supplied
 * raw regex text — same shape as the original PHONE_REGEX, generalized: an optional
 * "+<country code>" prefix, then each group's digit count in order, allowing any mix of
 * spaces/dots/dashes between groups and an optional pair of parentheses around the first
 * group (so "(408) 368-1105" keeps matching exactly as it did before).
 */
export function buildPatternMatcher(rule) {
  const groupSizes = (rule.group_sizes || []).filter((n) => Number.isInteger(n) && n > 0);
  if (!groupSizes.length) return null;

  const groupPatterns = groupSizes.map((size, i) =>
    i === 0 ? `(?:\\(\\s*\\d{${size}}\\s*\\)|\\d{${size}})` : `\\d{${size}}`
  );
  const numberPart = groupPatterns.join("[\\s.-]*");

  const ccDigits = String(rule.country_code || "").replace(/\D/g, "");
  const ccPart = ccDigits ? `(?:\\+?${ccDigits}[\\s.-]*)?` : "";

  const regex = new RegExp(`(^|[^\\d])(${ccPart}${numberPart})(?=$|[^\\d])`, "g");
  const nationalLength = groupSizes.reduce((a, b) => a + b, 0);

  return { rule, regex, groupSizes, nationalLength, ccDigits };
}

export function buildPhoneMatchers(patternRules) {
  return patternRules.map(buildPatternMatcher).filter(Boolean);
}

function formatWithMatcher(nationalDigits, matcher) {
  let index = 0;
  const parts = matcher.groupSizes.map((size) => {
    const part = nationalDigits.slice(index, index + size);
    index += size;
    return part;
  });
  const sep = matcher.rule.separator || "-";
  const prefix = matcher.ccDigits ? `+${matcher.ccDigits} ` : "";
  return prefix + parts.join(sep);
}

/**
 * Generalized version of normalizeUSPhone: runs every active pattern (in priority order)
 * over the value, reformatting the first candidate each pattern's regex recognizes with the
 * right total digit count. A pattern that doesn't match this value's digit count leaves it
 * untouched — same "leave it alone if it doesn't look like a valid number" behavior as the
 * original.
 */
export function normalizePhoneValueWithRules(value, matchers) {
  if (!value || !matchers.length) return value;

  let result = String(value);
  for (const matcher of matchers) {
    result = result.replace(matcher.regex, (match, before, phone) => {
      const digits = phone.replace(/\D/g, "");
      const { nationalLength, ccDigits } = matcher;

      let national = null;
      if (digits.length === nationalLength) {
        national = digits;
      } else if (ccDigits && digits.length === nationalLength + ccDigits.length && digits.startsWith(ccDigits)) {
        national = digits.slice(ccDigits.length);
      }

      if (!national) return match;
      return before + formatWithMatcher(national, matcher);
    });
  }
  return result;
}

/**
 * Generalized version of normalizePhoneRows: which headers to scan and which patterns to
 * apply both come from the admin-configured rules instead of the hardcoded defaults.
 */
export function normalizePhoneRowsWithRules(rows, headerNames, matchers) {
  if (!rows.length) return { rows, changedCount: 0, matchedHeaders: [] };

  const wanted = new Set(headerNames.map((h) => h.trim().toLowerCase()));
  const actualHeaders = Object.keys(rows[0]);
  const matchedHeaders = actualHeaders.filter((h) => wanted.has(h.trim().toLowerCase()));

  let changedCount = 0;

  const nextRows = rows.map((row) => {
    const next = { ...row };
    matchedHeaders.forEach((header) => {
      const before = next[header];
      const after = normalizePhoneValueWithRules(before, matchers);
      if (after !== before) changedCount += 1;
      next[header] = after;
    });
    return next;
  });

  return { rows: nextRows, changedCount, matchedHeaders };
}
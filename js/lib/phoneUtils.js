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
export const PHONE_HEADER_CANDIDATES = ["mobile no.", "direct no.,additional phone no."];

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

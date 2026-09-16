// Ported from the original syncReportToContactSheet() Apps Script. The Apps Script
// hardcoded a JS object mapping "Report" column headers to "Contact" sheet column
// headers and copied rows across in-place inside a spreadsheet. Here the mapping
// itself lives in Supabase (contact_field_mappings) so an admin can add, rename,
// reorder or retire a field without touching code, and the "sync" runs against an
// uploaded CSV export instead of a live sheet.

import { supabase } from "../supabaseClient.js";

/**
 * Fetches active field mappings, ordered the same way they're edited in the
 * admin panel (sort_order ascending). Inactive mappings are left out entirely,
 * mirroring how job_title_rules.is_active retires a rule without deleting it.
 */
export async function fetchFieldMappings() {
  const { data, error } = await supabase
    .from("contact_field_mappings")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return data;
}

function isBlankCell(value) {
  return value === "" || value === null || value === undefined;
}

/** Case-sensitive, whitespace-trimmed match — same as the Apps Script's `header.trim()`. */
function buildHeaderIndex(headers) {
  const index = {};
  headers.forEach((h, i) => {
    index[String(h ?? "").trim()] = i;
  });
  return index;
}

/**
 * Builds the contact sheet's column order from the mapping list: one column
 * per distinct contact_header, first-seen order wins (lowest sort_order),
 * exactly like the original object literal — if two mappings ever pointed at
 * the same destination column, the later one in iteration order would simply
 * overwrite the earlier one's value, never add a second column.
 */
export function getContactHeaders(mappings) {
  const seen = new Set();
  const headers = [];
  for (const m of mappings) {
    if (!seen.has(m.contact_header)) {
      seen.add(m.contact_header);
      headers.push(m.contact_header);
    }
  }
  return headers;
}

/**
 * Report CSV headers that at least one active mapping expects, but which are
 * absent from the uploaded file. Surfaced so an admin/user can fix the export
 * or the mapping instead of silently getting blank columns.
 */
export function getMissingReportHeaders(reportHeaders, mappings) {
  const reportHeaderIndex = buildHeaderIndex(reportHeaders);
  const missing = [];
  const seen = new Set();
  for (const m of mappings) {
    if (!(m.report_header in reportHeaderIndex) && !seen.has(m.report_header)) {
      seen.add(m.report_header);
      missing.push(m.report_header);
    }
  }
  return missing;
}

/** Report CSV columns that no active mapping currently targets. */
export function getUnmappedReportHeaders(reportHeaders, mappings) {
  const mapped = new Set(mappings.map((m) => m.report_header));
  return reportHeaders.map((h) => String(h ?? "").trim()).filter((h) => h && !mapped.has(h));
}

/**
 * Core of the port: walks every report row, applies the mapping, and produces
 * contact-sheet rows — same semantics as the Apps Script's forEach loop:
 *   - fully empty rows are skipped entirely
 *   - a mapping whose report_header isn't present in this file is skipped
 *     for that column (recorded once in `missingReportHeaders`, not per row)
 *   - every contact column starts blank and is only filled where a mapping
 *     and matching report column both exist
 *
 * @param reportHeaders  headers exactly as read from the uploaded CSV (row 1)
 * @param reportRows     array of row objects keyed by report header
 * @param mappings       active rows from contact_field_mappings, sort_order asc
 */
export function buildContactSheet(reportHeaders, reportRows, mappings) {
  const contactHeaders = getContactHeaders(mappings);
  const reportHeaderIndex = buildHeaderIndex(reportHeaders);
  const missingReportHeaders = getMissingReportHeaders(reportHeaders, mappings);
  const unmappedReportHeaders = getUnmappedReportHeaders(reportHeaders, mappings);

  const usableMappings = mappings.filter((m) => m.report_header in reportHeaderIndex);

  let skippedEmptyRows = 0;
  const contactRows = [];

  reportRows.forEach((row) => {
    const values = reportHeaders.map((h) => row[h]);
    if (values.every(isBlankCell)) {
      skippedEmptyRows += 1;
      return;
    }

    const newRow = {};
    contactHeaders.forEach((h) => {
      newRow[h] = "";
    });

    for (const m of usableMappings) {
      newRow[m.contact_header] = row[m.report_header] ?? "";
    }

    contactRows.push(newRow);
  });

  return {
    contactHeaders,
    contactRows,
    stats: {
      totalReportRows: reportRows.length,
      skippedEmptyRows,
      syncedRows: contactRows.length,
      missingReportHeaders,
      unmappedReportHeaders
    }
  };
}

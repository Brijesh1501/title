// Orchestrates all six tools as one pipeline, always in the same fixed order:
//   1. Report → Contact Sync   4. Phone Number Formatter
//   2. Highlight Latest Rows   5. Fill Missing Location Data
//   3. Job Title Categorizer   6. Data Quality Checks
//
// Each step is a thin wrapper around the exact same function the standalone tool page
// calls — nothing here re-implements the ported Apps Script logic, it only threads the
// data (and two parallel "what got highlighted" arrays) from one step into the next.
//
// PIPELINE_STEPS is the single source of truth for both the UI (which renders steps in
// this order) and runPipeline() (which executes them in this order): even if the person
// checks the boxes out of sequence, execution always follows this array, so "run these
// selected steps" and "run them in the required order" can never drift apart.

import { buildContactSheet, getContactHeaders } from "./reportSync.js";
import { computeLatestRows } from "./highlightLatest.js";
import { categorizeTitlesChunked } from "./titleTaxonomy.js";
import { normalizePhoneRows } from "./phoneUtils.js";
import { fillMissingLocationData, resolveMainColumns } from "./timezoneFill.js";
import {
  runDomainMatchCheck,
  runDuplicateEmailCheck,
  withStatusColumn,
  statusColorKey,
  DOMAIN_MATCH_HEADER,
  DUPLICATE_STATUS_HEADER
} from "./dataQuality.js";

export const PIPELINE_STEPS = [
  {
    id: "report-sync",
    label: "Report → Contact Sync",
    description: "Rewrites a raw report export into a contact sheet using the field mapping stored in Supabase.",
    needsConfig: false
  },
  {
    id: "highlight-latest",
    label: "Highlight Latest Rows",
    description: "Groups rows by Website and flags the most recent one in each group.",
    needsConfig: true
  },
  {
    id: "job-title",
    label: "Job Title Categorizer",
    description: "Sorts each Title into a Responsibility Area, Title Level and Department Function.",
    needsConfig: true
  },
  {
    id: "phone-format",
    label: "Phone Number Formatter",
    description: "Rewrites recognizable US phone numbers in \"Mobile No.\" / \"Direct No.\" into +1 XXX-XXX-XXXX.",
    needsConfig: false
  },
  {
    id: "location-fill",
    label: "Fill Missing Location Data",
    description: "Fills blank State, Country, Region or Timezone cells from the timezone lookup table.",
    needsConfig: true
  },
  {
    id: "data-quality",
    label: "Data Quality Checks",
    description: "Flags Website/Email domain mismatches and duplicate email addresses.",
    needsConfig: true
  }
];

function emptyFlags(rows) {
  return { rowFlags: rows.map(() => ({})), cellFlags: rows.map(() => new Map()) };
}

// ---------------------------------------------------------------------------
// Individual step runners — each takes the pipeline's current
// { headers, rows, rowFlags, cellFlags } plus that step's own options, and
// returns the same shape for the next step.
// ---------------------------------------------------------------------------

async function runReportSyncStep(state, { mappings }) {
  const { contactHeaders, contactRows, stats } = buildContactSheet(state.headers, state.rows, mappings);
  const flags = emptyFlags(contactRows);

  const summary =
    `Synced ${stats.syncedRows.toLocaleString()} of ${stats.totalReportRows.toLocaleString()} row(s)` +
    (stats.skippedEmptyRows ? ` (${stats.skippedEmptyRows.toLocaleString()} empty row(s) skipped)` : "") +
    ".";
  const warnings = [];
  if (stats.missingReportHeaders.length) {
    warnings.push(`${stats.missingReportHeaders.length} mapped column(s) weren't found in the source file.`);
  }

  return { headers: contactHeaders, rows: contactRows, ...flags, summary, warnings };
}

function runHighlightLatestStep(state, options) {
  const { latestRowIndexes, stats } = computeLatestRows(state.rows, options);
  const rowFlags = state.rowFlags.map((f, i) => (latestRowIndexes.has(i) ? { ...f, latest: true } : f));

  const summary = `Flagged ${stats.highlightedRows.toLocaleString()} latest row(s) across ${stats.websiteGroups.toLocaleString()} website group(s).`;
  const warnings = [];
  if (stats.skippedNoWebsite || stats.skippedNoDate) {
    const parts = [];
    if (stats.skippedNoWebsite) parts.push(`${stats.skippedNoWebsite} with a blank Website`);
    if (stats.skippedNoDate) parts.push(`${stats.skippedNoDate} with an unreadable date`);
    warnings.push(`${parts.join(" and ")} were left out of the grouping.`);
  }

  return { headers: state.headers, rows: state.rows, rowFlags, cellFlags: state.cellFlags, summary, warnings };
}

async function runJobTitleStep(state, { ruleSets, titleColumn, onProgress }) {
  const column = titleColumn || state.headers.find((h) => h.trim().toLowerCase() === "title") || state.headers[0];

  const titles = state.rows.map((r) => r[column]);
  const results = await categorizeTitlesChunked(titles, ruleSets, { onProgress });

  const existingCols = ["Responsibility Area", "Title Level", "Department Function"];
  const nextHeaders = existingCols.every((h) => state.headers.includes(h))
    ? state.headers
    : [...state.headers, ...existingCols.filter((h) => !state.headers.includes(h))];

  const rows = state.rows.map((row, i) => ({
    ...row,
    "Responsibility Area": results[i].respArea,
    "Title Level": results[i].titleLevel,
    "Department Function": results[i].deptFunction
  }));

  const rowFlags = state.rowFlags.map((f, i) => (results[i].highlight ? { ...f, category: results[i].highlight } : f));

  const blank = results.filter((r) => !r.title).length;
  const summary =
    `Categorized ${(state.rows.length - blank).toLocaleString()} title(s) using column "${column}"` +
    (blank ? `; ${blank.toLocaleString()} row(s) had a blank title.` : ".");

  return { headers: nextHeaders, rows, rowFlags, cellFlags: state.cellFlags, summary, warnings: [] };
}

function runPhoneFormatStep(state) {
  const { rows, changedCount, matchedHeaders } = normalizePhoneRows(state.rows);

  const summary = matchedHeaders.length
    ? `Reformatted ${changedCount.toLocaleString()} phone number(s) in: ${matchedHeaders.join(", ")}.`
    : `No "Mobile No." / "Direct No." column found — nothing to format.`;

  return { headers: state.headers, rows, rowFlags: state.rowFlags, cellFlags: state.cellFlags, summary, warnings: [] };
}

function runLocationFillStep(state, { lookupMaps, matchByCity = true }) {
  const mainCols = resolveMainColumns(state.headers);
  const { rows, filledCells, stats } = fillMissingLocationData(state.rows, mainCols, lookupMaps, { matchByCity });

  const cellFlags = state.cellFlags.map((existing, i) => {
    const merged = new Map(existing);
    filledCells[i].forEach((h) => merged.set(h, "filled"));
    return merged;
  });

  const summary =
    `Filled a location field on ${stats.rowsUpdated.toLocaleString()} row(s); ` +
    `${stats.rowsAlreadyComplete.toLocaleString()} were already complete; ` +
    `${stats.rowsNotFilled.toLocaleString()} still have a gap.`;

  return { headers: state.headers, rows, rowFlags: state.rowFlags, cellFlags, summary, warnings: [] };
}

function runDataQualityStep(state, { websiteHeader, emailHeader, runDomainCheck = true, runDuplicateCheck = true }) {
  let headers = state.headers;
  let rows = state.rows;
  const statusHeaders = [];
  const summaryParts = [];

  if (runDomainCheck) {
    const { statuses, stats } = runDomainMatchCheck(rows, websiteHeader, emailHeader);
    ({ headers, rows } = withStatusColumn(headers, rows, DOMAIN_MATCH_HEADER, statuses));
    statusHeaders.push(DOMAIN_MATCH_HEADER);
    summaryParts.push(`domain match — ${stats.matched} matched / ${stats.notMatched} not matched / ${stats.missing} missing`);
  }

  if (runDuplicateCheck) {
    const { statuses, stats } = runDuplicateEmailCheck(rows, emailHeader);
    ({ headers, rows } = withStatusColumn(headers, rows, DUPLICATE_STATUS_HEADER, statuses));
    statusHeaders.push(DUPLICATE_STATUS_HEADER);
    summaryParts.push(`duplicate email — ${stats.duplicate} duplicate / ${stats.unique} unique / ${stats.missing} missing`);
  }

  const cellFlags = state.cellFlags.map((existing, i) => {
    const merged = new Map(existing);
    statusHeaders.forEach((h) => merged.set(h, statusColorKey(rows[i][h])));
    return merged;
  });

  const summary = summaryParts.length ? `Ran ${summaryParts.join("; ")}.` : "No checks were selected.";

  return { headers, rows, rowFlags: state.rowFlags, cellFlags, summary, warnings: [] };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Runs the selected steps, always in PIPELINE_STEPS order, threading
 * { headers, rows, rowFlags, cellFlags } from each step into the next.
 *
 * @param initialHeaders   headers of the uploaded CSV
 * @param initialRows      rows of the uploaded CSV, keyed by header
 * @param selectedStepIds  Set<string> of PIPELINE_STEPS ids to run
 * @param resources        { reportSync: {mappings}, jobTitle: {ruleSets}, locationFill: {lookupMaps} }
 *                          — pre-fetched Supabase data each relevant step needs
 * @param stepOptions       { [stepId]: <that step's own options> }, e.g.
 *                          stepOptions["highlight-latest"] = { websiteHeader, mode, dateHeader, dateFormat, campaignHeader }
 * @param callbacks         { onStepStart(step), onStepComplete(step, result), onTitleProgress(progress) }
 *
 * @returns { headers, rows, rowFlags, cellFlags, log: [{id,label,summary,warnings}] }
 */
export async function runPipeline(initialHeaders, initialRows, selectedStepIds, resources, stepOptions, callbacks = {}) {
  const { onStepStart, onStepComplete, onTitleProgress } = callbacks;

  let state = { headers: initialHeaders, rows: initialRows, ...emptyFlags(initialRows) };
  const log = [];

  for (const step of PIPELINE_STEPS) {
    if (!selectedStepIds.has(step.id)) continue;
    if (onStepStart) onStepStart(step);

    let result;
    switch (step.id) {
      case "report-sync":
        result = await runReportSyncStep(state, resources.reportSync);
        break;
      case "highlight-latest":
        result = runHighlightLatestStep(state, stepOptions["highlight-latest"]);
        break;
      case "job-title":
        result = await runJobTitleStep(state, {
          ...resources.jobTitle,
          ...stepOptions["job-title"],
          onProgress: onTitleProgress
        });
        break;
      case "phone-format":
        result = runPhoneFormatStep(state);
        break;
      case "location-fill":
        result = runLocationFillStep(state, { ...resources.locationFill, ...stepOptions["location-fill"] });
        break;
      case "data-quality":
        result = runDataQualityStep(state, stepOptions["data-quality"]);
        break;
      default:
        continue;
    }

    state = { headers: result.headers, rows: result.rows, rowFlags: result.rowFlags, cellFlags: result.cellFlags };
    const entry = { id: step.id, label: step.label, summary: result.summary, warnings: result.warnings || [] };
    log.push(entry);
    if (onStepComplete) onStepComplete(step, entry);
  }

  return { ...state, log };
}

/**
 * What the downstream steps will see as their column headers, accounting for whether
 * Report → Contact Sync (which can rename/reshape the header set entirely) is selected to
 * run first. Used by the page to populate column pickers for later steps with headers that
 * will actually exist by the time those steps run, rather than the raw upload's headers.
 */
export function resolveEffectiveHeaders(uploadedHeaders, reportSyncSelected, mappings) {
  if (reportSyncSelected && mappings && mappings.length) {
    return getContactHeaders(mappings);
  }
  return uploadedHeaders;
}

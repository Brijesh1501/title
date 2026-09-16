import { mountSidebar } from "../components/sidebar.js";
import {
  fetchFieldMappings,
  buildContactSheet
} from "../lib/reportSync.js";
import { downloadCsv, downloadHighlightedXlsx, parseCsvFile } from "../lib/csv.js";

mountSidebar("report-sync.html");

// Above this many rows we stop live-rendering every row in the on-page table
// (the DOM chokes long before the data does) — both downloads always contain
// every synced row, however many there are.
const TABLE_PREVIEW_LIMIT = 500;

const state = {
  mappings: null,
  reportHeaders: null,
  reportRows: null,
  fileName: "",
  contactHeaders: [],
  contactRows: []
};

const el = {
  banner: document.getElementById("mapping-banner"),
  fileInput: document.getElementById("file-input"),
  clearBtn: document.getElementById("clear-upload-btn"),
  uploadHint: document.getElementById("upload-hint"),
  syncBtn: document.getElementById("sync-btn"),
  resultsBlock: document.getElementById("results-block"),
  resultsThead: document.getElementById("results-thead"),
  resultsTbody: document.getElementById("results-tbody"),
  exportBtn: document.getElementById("export-btn"),
  exportCsvBtn: document.getElementById("export-csv-btn"),
  tableNote: document.getElementById("table-note"),
  progressWrap: document.getElementById("progress-wrap"),
  progressFill: document.getElementById("progress-fill"),
  progressText: document.getElementById("progress-text"),
  progressCount: document.getElementById("progress-count")
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function showBanner(html) {
  el.banner.innerHTML = html || "";
}

function errorBanner(message) {
  showBanner(`<div class="banner banner--error">${escapeHtml(message)}</div>`);
}

function showProgress(text) {
  el.progressWrap.style.display = "";
  el.progressText.textContent = text;
  el.progressFill.style.width = "0%";
  el.progressCount.textContent = "";
}

function hideProgress() {
  el.progressWrap.style.display = "none";
}

// Papa's `header: true` keys rows by the header text exactly as it appears in
// the file. Report exports sometimes carry stray leading/trailing whitespace
// on headers, so trim them the same way the original Apps Script did
// (`reportHeaders.map(h => h.trim())`) before matching against the mapping.
function trimRowHeaders(rows) {
  if (!rows.length) return { headers: [], rows };
  const rawHeaders = Object.keys(rows[0]);
  const trimmedHeaders = rawHeaders.map((h) => h.trim());
  const changed = rawHeaders.some((h, i) => h !== trimmedHeaders[i]);

  if (!changed) return { headers: rawHeaders, rows };

  const nextRows = rows.map((row) => {
    const next = {};
    rawHeaders.forEach((raw, i) => {
      next[trimmedHeaders[i]] = row[raw];
    });
    return next;
  });
  return { headers: trimmedHeaders, rows: nextRows };
}

async function init() {
  try {
    state.mappings = await fetchFieldMappings();
    if (state.mappings.length === 0) {
      errorBanner(
        "No active field mappings found. Add at least one on the Manage Field Mapping page " +
          "before syncing a report."
      );
      return;
    }
    el.syncBtn.disabled = !state.reportRows;
    el.syncBtn.textContent = "Sync to contact sheet";
  } catch (err) {
    errorBanner(
      `Couldn't load field mapping from Supabase: ${err.message}. Confirm js/config.js is ` +
        `filled in and that supabase/schema.sql has been run.`
    );
  }
}

el.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  state.fileName = file.name;

  showProgress("Reading CSV…");
  el.syncBtn.disabled = true;
  el.resultsBlock.style.display = "none";

  let rawRows;
  try {
    rawRows = await parseCsvFile(file, ({ rowsParsed, percent }) => {
      el.progressFill.style.width = `${percent ?? 0}%`;
      el.progressCount.textContent = `${rowsParsed.toLocaleString()} rows read`;
    });
  } finally {
    hideProgress();
  }

  const { headers, rows } = trimRowHeaders(rawRows);
  state.reportHeaders = headers;
  state.reportRows = rows;

  el.clearBtn.style.display = "";
  el.uploadHint.style.display = "";
  el.uploadHint.textContent = `Loaded ${rows.length.toLocaleString()} rows and ${headers.length} column(s) from ${state.fileName}.`;

  if (state.mappings) {
    el.syncBtn.disabled = false;
    el.syncBtn.textContent = "Sync to contact sheet";
  }
});

el.clearBtn.addEventListener("click", () => {
  state.reportHeaders = null;
  state.reportRows = null;
  state.fileName = "";
  el.fileInput.value = "";
  el.clearBtn.style.display = "none";
  el.uploadHint.style.display = "none";
  el.resultsBlock.style.display = "none";
  el.syncBtn.disabled = true;
  showBanner("");
});

el.syncBtn.addEventListener("click", () => {
  if (!state.mappings || !state.reportRows) return;

  const { contactHeaders, contactRows, stats } = buildContactSheet(
    state.reportHeaders,
    state.reportRows,
    state.mappings
  );

  state.contactHeaders = contactHeaders;
  state.contactRows = contactRows;

  renderMappingBanner(stats);
  renderResults(contactHeaders, contactRows);
});

function renderMappingBanner(stats) {
  const parts = [];

  if (stats.missingReportHeaders.length) {
    parts.push(
      `<div class="banner banner--error">` +
        `${stats.missingReportHeaders.length} mapped column(s) weren't found in this file and were left blank: ` +
        `${stats.missingReportHeaders.map(escapeHtml).join(", ")}.</div>`
    );
  }

  parts.push(
    `<div class="banner">` +
      `Synced ${stats.syncedRows.toLocaleString()} of ${stats.totalReportRows.toLocaleString()} row(s)` +
      `${stats.skippedEmptyRows ? ` (${stats.skippedEmptyRows.toLocaleString()} fully empty row(s) skipped)` : ""}.` +
      `</div>`
  );

  if (stats.unmappedReportHeaders.length) {
    parts.push(
      `<div class="banner">` +
        `${stats.unmappedReportHeaders.length} column(s) in this file aren't mapped yet and were ignored: ` +
        `${stats.unmappedReportHeaders.map(escapeHtml).join(", ")}. ` +
        `<a href="admin-mappings.html">Add a mapping</a> to include them.</div>`
    );
  }

  showBanner(parts.join(""));
}

function renderResults(headers, rows) {
  el.resultsThead.innerHTML = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;

  const previewRows = rows.slice(0, TABLE_PREVIEW_LIMIT);
  el.resultsTbody.innerHTML = previewRows
    .map((row) => `<tr>${headers.map((h) => `<td>${escapeHtml(row[h])}</td>`).join("")}</tr>`)
    .join("");

  if (rows.length > TABLE_PREVIEW_LIMIT) {
    el.tableNote.style.display = "";
    el.tableNote.textContent = `Showing the first ${TABLE_PREVIEW_LIMIT.toLocaleString()} of ${rows.length.toLocaleString()} rows. Both downloads include all ${rows.length.toLocaleString()} rows.`;
  } else {
    el.tableNote.style.display = "none";
  }

  el.resultsBlock.style.display = rows.length ? "" : "none";
}

function exportBaseName() {
  const stem = state.fileName ? state.fileName.replace(/\.csv$/i, "") : "report";
  return `contact-sheet-${stem}`;
}

el.exportCsvBtn.addEventListener("click", () => {
  downloadCsv(state.contactRows, `${exportBaseName()}.csv`);
});

el.exportBtn.addEventListener("click", async () => {
  const originalLabel = el.exportBtn.textContent;
  el.exportBtn.disabled = true;
  el.exportBtn.textContent = "Building Excel file…";
  try {
    const highlights = new Array(state.contactRows.length).fill(null);
    await downloadHighlightedXlsx(state.contactHeaders, state.contactRows, highlights, `${exportBaseName()}.xlsx`);
  } finally {
    el.exportBtn.disabled = false;
    el.exportBtn.textContent = originalLabel;
  }
});

init();

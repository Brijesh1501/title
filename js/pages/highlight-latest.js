import { mountSidebar } from "../components/sidebar.js";
import { computeLatestRows } from "../lib/highlightLatest.js";
import { downloadCsv, downloadHighlightedXlsx, parseCsvFile } from "../lib/csv.js";

mountSidebar("highlight-latest.html");

const TABLE_PREVIEW_LIMIT = 500;
const LATEST_COLUMN = "Is Latest";

const state = {
  headers: [],
  rows: [],
  fileName: "",
  latestRowIndexes: null
};

const el = {
  banner: document.getElementById("banner"),
  fileInput: document.getElementById("file-input"),
  clearBtn: document.getElementById("clear-upload-btn"),
  uploadHint: document.getElementById("upload-hint"),
  configPanel: document.getElementById("config-panel"),
  websiteSelect: document.getElementById("website-select"),
  dateSelect: document.getElementById("date-select"),
  campaignSelect: document.getElementById("campaign-select"),
  createdDatePanel: document.getElementById("created-date-panel"),
  campaignNamePanel: document.getElementById("campaign-name-panel"),
  runBtn: document.getElementById("run-btn"),
  resultsBlock: document.getElementById("results-block"),
  resultsThead: document.getElementById("results-thead"),
  resultsTbody: document.getElementById("results-tbody"),
  tableNote: document.getElementById("table-note"),
  exportBtn: document.getElementById("export-btn"),
  exportCsvBtn: document.getElementById("export-csv-btn")
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

function currentMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function currentDateFormat() {
  return document.querySelector('input[name="dateFormat"]:checked').value;
}

// Best-effort default so most files need zero clicks before hitting Run —
// exact header first, then a loose "contains" match.
function guessHeader(headers, exact, contains) {
  const lower = headers.map((h) => h.toLowerCase());
  let i = lower.indexOf(exact.toLowerCase());
  if (i === -1) i = lower.findIndex((h) => h.includes(contains.toLowerCase()));
  return i === -1 ? headers[0] : headers[i];
}

function populateSelect(select, headers, selected) {
  select.innerHTML = headers.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join("");
  select.value = selected;
}

function updateModeVisibility() {
  const mode = currentMode();
  el.createdDatePanel.style.display = mode === "created_date" ? "" : "none";
  el.campaignNamePanel.style.display = mode === "campaign_name" ? "" : "none";
}

document.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener("change", updateModeVisibility);
});

el.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  state.fileName = file.name;
  showBanner("");
  el.resultsBlock.style.display = "none";
  el.runBtn.disabled = true;
  el.runBtn.textContent = "Reading CSV…";

  const rows = await parseCsvFile(file);
  if (!rows.length) {
    errorBanner("That file has no data rows.");
    el.runBtn.textContent = "Upload a CSV to continue";
    return;
  }

  state.headers = Object.keys(rows[0]);
  state.rows = rows;

  el.clearBtn.style.display = "";
  el.uploadHint.style.display = "";
  el.uploadHint.textContent = `Loaded ${rows.length.toLocaleString()} rows and ${state.headers.length} column(s) from ${state.fileName}.`;

  populateSelect(el.websiteSelect, state.headers, guessHeader(state.headers, "Website", "website"));
  populateSelect(el.dateSelect, state.headers, guessHeader(state.headers, "Created Date", "date"));
  populateSelect(el.campaignSelect, state.headers, guessHeader(state.headers, "Campaign Name", "campaign"));

  el.configPanel.style.display = "";
  updateModeVisibility();

  el.runBtn.disabled = false;
  el.runBtn.textContent = "Highlight latest rows";
});

el.clearBtn.addEventListener("click", () => {
  state.headers = [];
  state.rows = [];
  state.fileName = "";
  state.latestRowIndexes = null;
  el.fileInput.value = "";
  el.clearBtn.style.display = "none";
  el.uploadHint.style.display = "none";
  el.configPanel.style.display = "none";
  el.resultsBlock.style.display = "none";
  el.runBtn.disabled = true;
  el.runBtn.textContent = "Upload a CSV to continue";
  showBanner("");
});

el.runBtn.addEventListener("click", () => {
  const mode = currentMode();

  const { latestRowIndexes, stats } = computeLatestRows(state.rows, {
    websiteHeader: el.websiteSelect.value,
    mode,
    dateHeader: el.dateSelect.value,
    dateFormat: currentDateFormat(),
    campaignHeader: el.campaignSelect.value
  });

  state.latestRowIndexes = latestRowIndexes;
  renderBanner(stats, mode);
  renderResults();
});

function renderBanner(stats, mode) {
  const parts = [];

  if (!stats.websiteGroups) {
    parts.push(
      `<div class="banner banner--error">No rows had both a Website and a usable ${
        mode === "campaign_name" ? "Campaign Name" : "date"
      } value — nothing to highlight.</div>`
    );
  }

  parts.push(
    `<div class="banner">Highlighted ${stats.highlightedRows.toLocaleString()} row(s) as the latest across ` +
      `${stats.websiteGroups.toLocaleString()} website(s), out of ${stats.totalRows.toLocaleString()} row(s) total.</div>`
  );

  const skipped = [];
  if (stats.skippedNoWebsite) skipped.push(`${stats.skippedNoWebsite.toLocaleString()} with a blank Website`);
  if (stats.skippedNoDate) {
    skipped.push(
      `${stats.skippedNoDate.toLocaleString()} with an unreadable ${
        mode === "campaign_name" ? "Campaign Name" : "date"
      }`
    );
  }
  if (skipped.length) {
    parts.push(`<div class="banner">${skipped.join(" and ")} were left out of the grouping entirely.</div>`);
  }

  showBanner(parts.join(""));
}

function renderResults() {
  const headers = [...state.headers, LATEST_COLUMN];

  el.resultsThead.innerHTML = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;

  const previewRows = state.rows.slice(0, TABLE_PREVIEW_LIMIT);
  el.resultsTbody.innerHTML = previewRows
    .map((row, i) => {
      const isLatest = state.latestRowIndexes.has(i);
      const rowClass = isLatest ? ` class="row-highlight-latest"` : "";
      const cells = state.headers.map((h) => `<td>${escapeHtml(row[h])}</td>`).join("");
      return `<tr${rowClass}>${cells}<td>${isLatest ? "Yes" : ""}</td></tr>`;
    })
    .join("");

  if (state.rows.length > TABLE_PREVIEW_LIMIT) {
    el.tableNote.style.display = "";
    el.tableNote.textContent = `Showing the first ${TABLE_PREVIEW_LIMIT.toLocaleString()} of ${state.rows.length.toLocaleString()} rows. Both downloads include all ${state.rows.length.toLocaleString()} rows.`;
  } else {
    el.tableNote.style.display = "none";
  }

  el.resultsBlock.style.display = "";
}

function getExportData() {
  const headers = [...state.headers, LATEST_COLUMN];
  const rows = state.rows.map((row, i) => ({
    ...row,
    [LATEST_COLUMN]: state.latestRowIndexes.has(i) ? "Yes" : ""
  }));
  const highlights = state.rows.map((_, i) => (state.latestRowIndexes.has(i) ? "latest" : null));
  const stem = state.fileName ? state.fileName.replace(/\.csv$/i, "") : "report";
  return { headers, rows, highlights, baseName: `highlighted-${stem}` };
}

el.exportCsvBtn.addEventListener("click", () => {
  const { rows, baseName } = getExportData();
  downloadCsv(rows, `${baseName}.csv`);
});

el.exportBtn.addEventListener("click", async () => {
  const originalLabel = el.exportBtn.textContent;
  el.exportBtn.disabled = true;
  el.exportBtn.textContent = "Building Excel file…";
  try {
    const { headers, rows, highlights, baseName } = getExportData();
    await downloadHighlightedXlsx(headers, rows, highlights, `${baseName}.xlsx`, "Highlighted");
  } finally {
    el.exportBtn.disabled = false;
    el.exportBtn.textContent = originalLabel;
  }
});

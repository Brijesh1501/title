import { mountSidebar } from "../components/sidebar.js";
import { fetchTaxonomyRules, categorizeTitles, categorizeTitlesChunked } from "../lib/titleTaxonomy.js";
import { downloadCsv, downloadHighlightedXlsx, parseCsvFile } from "../lib/csv.js";

mountSidebar("job-title-categorizer.html");

// Above this many rows we stop live-rendering every row in the on-page table
// (the DOM chokes long before the data does) but the CSV export always
// contains every single processed row, however many there are.
const TABLE_PREVIEW_LIMIT = 500;

const state = {
  ruleSets: null,
  uploadedRows: null, // rows from CSV upload, if any
  titleColumn: null,
  fileName: "",
  results: []
};

const el = {
  banner: document.getElementById("rules-banner"),
  fileInput: document.getElementById("file-input"),
  clearBtn: document.getElementById("clear-upload-btn"),
  textarea: document.getElementById("titles-textarea"),
  uploadHint: document.getElementById("upload-hint"),
  categorizeBtn: document.getElementById("categorize-btn"),
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

function showProgress(text) {
  el.progressWrap.style.display = "";
  el.progressText.textContent = text;
  el.progressFill.style.width = "0%";
  el.progressCount.textContent = "";
}

function updateProgress({ done, total, percent }) {
  el.progressFill.style.width = `${percent ?? 0}%`;
  el.progressCount.textContent = total != null ? `${done.toLocaleString()} / ${total.toLocaleString()}` : "";
}

function hideProgress() {
  el.progressWrap.style.display = "none";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function showBanner(message) {
  el.banner.innerHTML = message
    ? `<div class="banner banner--error">${escapeHtml(message)}</div>`
    : "";
}

async function init() {
  try {
    state.ruleSets = await fetchTaxonomyRules();
    el.categorizeBtn.disabled = false;
    el.categorizeBtn.textContent = "Categorize";
  } catch (err) {
    showBanner(
      `Couldn't load rules from Supabase: ${err.message}. Confirm js/config.js is filled in and ` +
        `that supabase/schema.sql has been run.`
    );
  }
}

el.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  state.fileName = file.name;

  showProgress("Reading CSV…");
  el.categorizeBtn.disabled = true;
  try {
    state.uploadedRows = await parseCsvFile(file, ({ rowsParsed, percent }) => {
      updateProgress({ done: rowsParsed, total: null, percent: percent ?? 0 });
      el.progressCount.textContent = `${rowsParsed.toLocaleString()} rows read`;
    });
  } finally {
    hideProgress();
    el.categorizeBtn.disabled = !state.ruleSets;
  }

  state.titleColumn =
    Object.keys(state.uploadedRows[0] || {}).find((h) => h.trim().toLowerCase() === "title") ||
    Object.keys(state.uploadedRows[0] || {})[0] ||
    null;

  el.textarea.style.display = "none";
  el.clearBtn.style.display = "";
  el.uploadHint.style.display = "";
  el.uploadHint.textContent = `Loaded ${state.uploadedRows.length.toLocaleString()} rows from ${state.fileName}. Using column "${state.titleColumn}" as the title field.`;
});

el.clearBtn.addEventListener("click", () => {
  state.uploadedRows = null;
  state.titleColumn = null;
  state.fileName = "";
  el.fileInput.value = "";
  el.textarea.style.display = "";
  el.clearBtn.style.display = "none";
  el.uploadHint.style.display = "none";
  el.resultsBlock.style.display = "none";
});

el.categorizeBtn.addEventListener("click", async () => {
  if (!state.ruleSets) return;

  el.categorizeBtn.disabled = true;
  const originalLabel = el.categorizeBtn.textContent;

  try {
    if (state.uploadedRows && state.titleColumn) {
      const titles = state.uploadedRows.map((r) => r[state.titleColumn]);
      showProgress("Categorizing…");
      state.results = await categorizeTitlesChunked(titles, state.ruleSets, {
        onProgress: (p) => {
          el.categorizeBtn.textContent = `Categorizing… ${p.percent}%`;
          updateProgress(p);
        }
      });
      // Every row gets its columns added — nothing is skipped or capped, however large the file is.
      state.uploadedRows = state.uploadedRows.map((row, i) => ({
        ...row,
        "Responsibility Area": state.results[i].respArea,
        "Title Level": state.results[i].titleLevel,
        "Department Function": state.results[i].deptFunction
      }));
      renderResults(Object.keys(state.uploadedRows[0]), state.uploadedRows, state.results);
    } else {
      const titles = el.textarea.value.split("\n").map((t) => t.trim()).filter(Boolean);
      state.results = categorizeTitles(titles, state.ruleSets);
      const headers = ["Title", "Responsibility Area", "Title Level", "Department Function"];
      const rows = state.results.map((r) => ({
        Title: r.title,
        "Responsibility Area": r.respArea,
        "Title Level": r.titleLevel,
        "Department Function": r.deptFunction
      }));
      renderResults(headers, rows, state.results);
    }
  } finally {
    hideProgress();
    el.categorizeBtn.disabled = false;
    el.categorizeBtn.textContent = originalLabel;
  }
});

function renderResults(headers, rows, resultsForHighlight) {
  el.resultsThead.innerHTML = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;

  // The full result set (all rows, no matter how many) always goes into the CSV export.
  // Only the on-page table preview is capped, since rendering thousands of <tr> elements
  // is what actually freezes the tab — the underlying data is never truncated.
  const previewRows = rows.slice(0, TABLE_PREVIEW_LIMIT);

  el.resultsTbody.innerHTML = previewRows
    .map((row, i) => {
      const highlight = resultsForHighlight[i]?.highlight;
      const rowClass = highlight ? ` class="row-highlight-${highlight}"` : "";
      const cells = headers.map((h) => `<td>${escapeHtml(row[h])}</td>`).join("");
      return `<tr${rowClass}>${cells}</tr>`;
    })
    .join("");

  if (rows.length > TABLE_PREVIEW_LIMIT) {
    el.tableNote.style.display = "";
    el.tableNote.textContent = `Showing the first ${TABLE_PREVIEW_LIMIT.toLocaleString()} of ${rows.length.toLocaleString()} rows. All ${rows.length.toLocaleString()} rows are included in both downloads.`;
  } else {
    el.tableNote.style.display = "none";
  }

  el.resultsBlock.style.display = "";
}

function getExportData() {
  if (state.uploadedRows) {
    return {
      headers: Object.keys(state.uploadedRows[0]),
      rows: state.uploadedRows,
      highlights: state.results.map((r) => r.highlight),
      baseName: state.fileName ? `categorized-${state.fileName.replace(/\.csv$/i, "")}` : "categorized-titles"
    };
  }
  const headers = ["Title", "Responsibility Area", "Title Level", "Department Function"];
  const rows = state.results.map((r) => ({
    Title: r.title,
    "Responsibility Area": r.respArea,
    "Title Level": r.titleLevel,
    "Department Function": r.deptFunction
  }));
  return { headers, rows, highlights: state.results.map((r) => r.highlight), baseName: "categorized-titles" };
}

el.exportCsvBtn.addEventListener("click", () => {
  const { rows, baseName } = getExportData();
  downloadCsv(rows, `${baseName}.csv`);
});

el.exportBtn.addEventListener("click", async () => {
  const { headers, rows, highlights, baseName } = getExportData();
  const originalLabel = el.exportBtn.textContent;
  el.exportBtn.disabled = true;
  el.exportBtn.textContent = "Building Excel file…";
  try {
    await downloadHighlightedXlsx(headers, rows, highlights, `${baseName}.xlsx`);
  } finally {
    el.exportBtn.disabled = false;
    el.exportBtn.textContent = originalLabel;
  }
});

init();

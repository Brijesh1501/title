import { mountSidebar } from "../components/sidebar.js";
import {
  fetchTimezoneLookup,
  buildLookupMaps,
  resolveMainColumns,
  fillMissingLocationData
} from "../lib/timezoneFill.js";
import { downloadCsv, downloadCellHighlightedXlsx, parseCsvFile } from "../lib/csv.js";

mountSidebar("location-fill.html");

const TABLE_PREVIEW_LIMIT = 500;

const state = {
  lookupMaps: null,
  headers: [],
  rows: [],
  mainCols: null,
  fileName: "",
  resultRows: null,
  filledCells: null
};

const el = {
  banner: document.getElementById("banner"),
  fileInput: document.getElementById("file-input"),
  clearBtn: document.getElementById("clear-upload-btn"),
  uploadHint: document.getElementById("upload-hint"),
  columnsHint: document.getElementById("columns-hint"),
  matchCityOption: document.getElementById("match-city-option"),
  matchCityCheckbox: document.getElementById("match-city-checkbox"),
  runBtn: document.getElementById("run-btn"),
  resultsBlock: document.getElementById("results-block"),
  resultsThead: document.getElementById("results-thead"),
  resultsTbody: document.getElementById("results-tbody"),
  tableNote: document.getElementById("table-note"),
  exportBtn: document.getElementById("export-btn"),
  exportCsvBtn: document.getElementById("export-csv-btn"),
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

async function init() {
  try {
    const lookupRows = await fetchTimezoneLookup();
    if (lookupRows.length === 0) {
      errorBanner(
        "The timezone lookup table is empty. Add rows on the Edit Timezone Lookup page, or " +
          "run supabase/timezone_seed.sql, before filling location data."
      );
      return;
    }
    state.lookupMaps = buildLookupMaps(lookupRows);
    if (state.rows.length) {
      el.runBtn.disabled = false;
      el.runBtn.textContent = "Fill missing location data";
    }
  } catch (err) {
    errorBanner(
      `Couldn't load the timezone lookup from Supabase: ${err.message}. Confirm js/config.js ` +
        `is filled in and that supabase/timezone_schema.sql has been run.`
    );
  }
}

el.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  state.fileName = file.name;

  showProgress("Reading CSV…");
  el.runBtn.disabled = true;
  el.resultsBlock.style.display = "none";

  let rows;
  try {
    rows = await parseCsvFile(file, ({ rowsParsed, percent }) => {
      el.progressFill.style.width = `${percent ?? 0}%`;
      el.progressCount.textContent = `${rowsParsed.toLocaleString()} rows read`;
    });
  } finally {
    hideProgress();
  }

  if (!rows.length) {
    errorBanner("That file has no data rows.");
    return;
  }

  state.headers = Object.keys(rows[0]);
  state.rows = rows;
  state.mainCols = resolveMainColumns(state.headers);

  el.clearBtn.style.display = "";
  el.uploadHint.style.display = "";
  el.uploadHint.textContent = `Loaded ${rows.length.toLocaleString()} rows and ${state.headers.length} column(s) from ${state.fileName}.`;

  const missing = ["state", "country", "region", "timezone"].filter((k) => !state.mainCols[k]);
  el.columnsHint.style.display = "";
  if (missing.length) {
    const labels = { state: "Primary State/Province", country: "Primary Country", region: "Region/Geography", timezone: "Timezone" };
    el.columnsHint.textContent = `Couldn't find a column for: ${missing.map((m) => labels[m]).join(", ")}. That field will be left untouched.`;
  } else {
    el.columnsHint.textContent = "Found all four location columns.";
  }

  if (state.mainCols.city) {
    el.matchCityOption.style.display = "";
  } else {
    el.matchCityOption.style.display = "none";
  }

  if (state.lookupMaps) {
    el.runBtn.disabled = false;
    el.runBtn.textContent = "Fill missing location data";
  }
});

el.clearBtn.addEventListener("click", () => {
  state.headers = [];
  state.rows = [];
  state.mainCols = null;
  state.fileName = "";
  state.resultRows = null;
  state.filledCells = null;
  el.fileInput.value = "";
  el.clearBtn.style.display = "none";
  el.uploadHint.style.display = "none";
  el.columnsHint.style.display = "none";
  el.matchCityOption.style.display = "none";
  el.resultsBlock.style.display = "none";
  el.runBtn.disabled = true;
  showBanner("");
});

el.runBtn.addEventListener("click", () => {
  if (!state.lookupMaps || !state.rows.length) return;

  const { rows, filledCells, stats } = fillMissingLocationData(state.rows, state.mainCols, state.lookupMaps, {
    matchByCity: el.matchCityCheckbox.checked
  });

  state.resultRows = rows;
  state.filledCells = filledCells;

  renderStatsBanner(stats);
  renderResults();
});

function renderStatsBanner(stats) {
  const parts = [
    `<div class="banner">` +
      `${stats.rowsUpdated.toLocaleString()} row(s) had at least one field filled in. ` +
      `${stats.rowsAlreadyComplete.toLocaleString()} row(s) were already complete and left as-is. ` +
      `${stats.rowsNotFilled.toLocaleString()} row(s) still have a gap — no lookup match was found for them.` +
      `</div>`
  ];
  showBanner(parts.join(""));
}

function renderResults() {
  const headers = state.headers;
  el.resultsThead.innerHTML = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;

  const previewRows = state.resultRows.slice(0, TABLE_PREVIEW_LIMIT);
  el.resultsTbody.innerHTML = previewRows
    .map((row, i) => {
      const filled = state.filledCells[i];
      const cells = headers
        .map((h) => `<td${filled.has(h) ? ` class="cell-filled"` : ""}>${escapeHtml(row[h])}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  if (state.resultRows.length > TABLE_PREVIEW_LIMIT) {
    el.tableNote.style.display = "";
    el.tableNote.textContent = `Showing the first ${TABLE_PREVIEW_LIMIT.toLocaleString()} of ${state.resultRows.length.toLocaleString()} rows. Both downloads include all ${state.resultRows.length.toLocaleString()} rows. Green cells were filled in by this run.`;
  } else {
    el.tableNote.style.display = "";
    el.tableNote.textContent = "Green cells were filled in by this run.";
  }

  el.resultsBlock.style.display = "";
}

function exportBaseName() {
  const stem = state.fileName ? state.fileName.replace(/\.csv$/i, "") : "contacts";
  return `${stem}-location-filled`;
}

el.exportCsvBtn.addEventListener("click", () => {
  downloadCsv(state.resultRows, `${exportBaseName()}.csv`);
});

el.exportBtn.addEventListener("click", async () => {
  const originalLabel = el.exportBtn.textContent;
  el.exportBtn.disabled = true;
  el.exportBtn.textContent = "Building Excel file…";
  try {
    await downloadCellHighlightedXlsx(
      state.headers,
      state.resultRows,
      state.filledCells,
      `${exportBaseName()}.xlsx`,
      "Location filled"
    );
  } finally {
    el.exportBtn.disabled = false;
    el.exportBtn.textContent = originalLabel;
  }
});

init();

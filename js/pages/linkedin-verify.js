import { mountSidebar } from "../components/sidebar.js";
import { statusColorKey } from "../lib/dataQuality.js";
import {
  collectUniqueUrls,
  runLinkedInVerification,
  LINKEDIN_STATUS_HEADER
} from "../lib/linkedinVerify.js";
import { downloadCsv, downloadCellHighlightedXlsx, parseCsvFile } from "../lib/csv.js";

mountSidebar("linkedin-verify.html");

const TABLE_PREVIEW_LIMIT = 500;

const state = {
  headers: [],
  rows: [],
  fileName: "",
  resultHeaders: null,
  resultRows: null
};

const el = {
  banner: document.getElementById("banner"),
  fileInput: document.getElementById("file-input"),
  clearBtn: document.getElementById("clear-upload-btn"),
  uploadHint: document.getElementById("upload-hint"),
  configPanel: document.getElementById("config-panel"),
  linkedinSelect: document.getElementById("linkedin-select"),
  accountSelect: document.getElementById("account-select"),
  statRow: document.getElementById("stat-row"),
  consentCheckbox: document.getElementById("consent-checkbox"),
  runBtn: document.getElementById("run-btn"),
  progressWrap: document.getElementById("progress-wrap"),
  progressFill: document.getElementById("progress-fill"),
  progressText: document.getElementById("progress-text"),
  progressCount: document.getElementById("progress-count"),
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

function guessHeader(headers, exact, contains) {
  if (!headers.length) return "";
  const lower = headers.map((h) => h.toLowerCase());
  let i = lower.indexOf(exact.toLowerCase());
  if (i === -1) i = lower.findIndex((h) => h.includes(contains.toLowerCase()));
  return i === -1 ? headers[0] : headers[i];
}

function populateSelect(select, headers, selected) {
  select.innerHTML = headers.map((h) => `<option value="${escapeHtml(h)}" ${h === selected ? "selected" : ""}>${escapeHtml(h)}</option>`).join("");
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

function updateRunButtonState() {
  const ready = state.rows.length > 0 && el.consentCheckbox.checked;
  el.runBtn.disabled = !ready;
  if (!state.rows.length) el.runBtn.textContent = "Upload a CSV to continue";
  else if (!el.consentCheckbox.checked) el.runBtn.textContent = "Confirm the notice above to continue";
  else el.runBtn.textContent = "Run LinkedIn verification";
}

function updateStatRow() {
  if (!state.rows.length) return;
  const linkedinHeader = el.linkedinSelect.value;
  const unique = collectUniqueUrls(state.rows, linkedinHeader);
  const missing = state.rows.length - state.rows.filter((r) => unique.length && r[linkedinHeader]).length;
  el.statRow.innerHTML = `
    <span class="stat-pill">${state.rows.length.toLocaleString()} row(s) uploaded</span>
    <span class="stat-pill">${unique.length.toLocaleString()} unique LinkedIn URL(s) will be submitted</span>
  `;
}

el.linkedinSelect.addEventListener("change", updateStatRow);
el.consentCheckbox.addEventListener("change", updateRunButtonState);

el.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  state.fileName = file.name;

  showBanner("");
  el.resultsBlock.style.display = "none";

  const rows = await parseCsvFile(file);
  if (!rows.length) {
    errorBanner("That file has no data rows.");
    return;
  }

  state.headers = Object.keys(rows[0]);
  state.rows = rows;

  el.clearBtn.style.display = "";
  el.uploadHint.style.display = "";
  el.uploadHint.textContent = `Loaded ${rows.length.toLocaleString()} rows and ${state.headers.length} column(s) from ${state.fileName}.`;

  populateSelect(el.linkedinSelect, state.headers, guessHeader(state.headers, "Contact LinkedIn", "linkedin"));
  populateSelect(el.accountSelect, state.headers, guessHeader(state.headers, "Account Name", "account"));

  el.configPanel.style.display = "";
  updateStatRow();
  updateRunButtonState();
});

el.clearBtn.addEventListener("click", () => {
  state.headers = [];
  state.rows = [];
  state.fileName = "";
  state.resultHeaders = null;
  state.resultRows = null;
  el.fileInput.value = "";
  el.clearBtn.style.display = "none";
  el.uploadHint.style.display = "none";
  el.configPanel.style.display = "none";
  el.resultsBlock.style.display = "none";
  el.consentCheckbox.checked = false;
  updateRunButtonState();
  showBanner("");
});

el.runBtn.addEventListener("click", async () => {
  el.runBtn.disabled = true;
  const originalLabel = el.runBtn.textContent;
  el.runBtn.textContent = "Running…";
  showBanner("");
  showProgress("Submitting URLs to Bright Data…");

  try {
    const result = await runLinkedInVerification(
      state.headers,
      state.rows,
      { linkedinHeader: el.linkedinSelect.value, accountHeader: el.accountSelect.value },
      {
        onStatusUpdate: ({ status, progress }) => {
          el.progressText.textContent = `Bright Data job status: ${status}`;
          if (typeof progress === "number") {
            el.progressFill.style.width = `${progress}%`;
            el.progressCount.textContent = `${progress}%`;
          }
        }
      }
    );

    state.resultHeaders = result.headers;
    state.resultRows = result.rows;

    showBanner(
      `<div class="banner">Checked ${result.uniqueUrlCount.toLocaleString()} unique LinkedIn URL(s), got ` +
        `${result.resultCount.toLocaleString()} profile(s) back. Results: ${result.stats.matched.toLocaleString()} matched, ` +
        `${result.stats.notMatched.toLocaleString()} not matched, ${result.stats.missing.toLocaleString()} missing data.</div>`
    );
    renderResults();
  } catch (err) {
    errorBanner(`LinkedIn verification failed: ${err.message}`);
  } finally {
    hideProgress();
    el.runBtn.disabled = false;
    el.runBtn.textContent = originalLabel;
    updateRunButtonState();
  }
});

function renderResults() {
  const headers = state.resultHeaders;

  el.resultsThead.innerHTML = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;

  const previewRows = state.resultRows.slice(0, TABLE_PREVIEW_LIMIT);
  el.resultsTbody.innerHTML = previewRows
    .map((row) => {
      const cells = headers
        .map((h) => {
          const isStatus = h === LINKEDIN_STATUS_HEADER;
          const cls = isStatus ? ` class="status-${statusColorKey(row[h])}"` : "";
          return `<td${cls}>${escapeHtml(row[h])}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  if (state.resultRows.length > TABLE_PREVIEW_LIMIT) {
    el.tableNote.style.display = "";
    el.tableNote.textContent = `Showing the first ${TABLE_PREVIEW_LIMIT.toLocaleString()} of ${state.resultRows.length.toLocaleString()} rows. Both downloads include all ${state.resultRows.length.toLocaleString()} rows.`;
  } else {
    el.tableNote.style.display = "none";
  }

  el.resultsBlock.style.display = "";
}

function exportBaseName() {
  const stem = state.fileName ? state.fileName.replace(/\.csv$/i, "") : "contacts";
  return `${stem}-linkedin-verified`;
}

el.exportCsvBtn.addEventListener("click", () => {
  downloadCsv(state.resultRows, `${exportBaseName()}.csv`);
});

el.exportBtn.addEventListener("click", async () => {
  const originalLabel = el.exportBtn.textContent;
  el.exportBtn.disabled = true;
  el.exportBtn.textContent = "Building Excel file…";
  try {
    const cellHighlights = state.resultRows.map((row) => {
      const map = new Map();
      map.set(LINKEDIN_STATUS_HEADER, statusColorKey(row[LINKEDIN_STATUS_HEADER]));
      return map;
    });
    await downloadCellHighlightedXlsx(
      state.resultHeaders,
      state.resultRows,
      cellHighlights,
      `${exportBaseName()}.xlsx`,
      "LinkedIn verified"
    );
  } finally {
    el.exportBtn.disabled = false;
    el.exportBtn.textContent = originalLabel;
  }
});

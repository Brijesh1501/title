import { mountSidebar } from "../components/sidebar.js";
import {
  DOMAIN_MATCH_HEADER,
  DUPLICATE_STATUS_HEADER,
  runDomainMatchCheck,
  runDuplicateEmailCheck,
  withStatusColumn,
  statusColorKey
} from "../lib/dataQuality.js";
import { downloadCsv, downloadCellHighlightedXlsx, parseCsvFile } from "../lib/csv.js";

mountSidebar("data-quality.html");

const TABLE_PREVIEW_LIMIT = 500;

const state = {
  headers: [],
  rows: [],
  fileName: "",
  resultHeaders: null,
  resultRows: null,
  statusHeaders: []
};

const el = {
  banner: document.getElementById("banner"),
  fileInput: document.getElementById("file-input"),
  clearBtn: document.getElementById("clear-upload-btn"),
  uploadHint: document.getElementById("upload-hint"),
  configPanel: document.getElementById("config-panel"),
  domainToggle: document.getElementById("domain-check-toggle"),
  duplicateToggle: document.getElementById("duplicate-check-toggle"),
  websiteSelect: document.getElementById("website-select"),
  emailSelect: document.getElementById("email-select"),
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
  const anyCheckSelected = el.domainToggle.checked || el.duplicateToggle.checked;
  el.runBtn.disabled = !state.rows.length || !anyCheckSelected;
  if (state.rows.length && !anyCheckSelected) {
    el.runBtn.textContent = "Select at least one check to run";
  } else if (state.rows.length) {
    el.runBtn.textContent = "Run checks";
  }
}

el.domainToggle.addEventListener("change", updateRunButtonState);
el.duplicateToggle.addEventListener("change", updateRunButtonState);

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

  el.clearBtn.style.display = "";
  el.uploadHint.style.display = "";
  el.uploadHint.textContent = `Loaded ${rows.length.toLocaleString()} rows and ${state.headers.length} column(s) from ${state.fileName}.`;

  populateSelect(el.websiteSelect, state.headers, guessHeader(state.headers, "Website", "website"));
  populateSelect(el.emailSelect, state.headers, guessHeader(state.headers, "Email Address", "email"));

  el.configPanel.style.display = "";
  updateRunButtonState();
});

el.clearBtn.addEventListener("click", () => {
  state.headers = [];
  state.rows = [];
  state.fileName = "";
  state.resultHeaders = null;
  state.resultRows = null;
  state.statusHeaders = [];
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
  let headers = state.headers;
  let rows = state.rows;
  const statusHeaders = [];
  const bannerParts = [];

  if (el.domainToggle.checked) {
    const { statuses, stats } = runDomainMatchCheck(rows, el.websiteSelect.value, el.emailSelect.value);
    ({ headers, rows } = withStatusColumn(headers, rows, DOMAIN_MATCH_HEADER, statuses));
    statusHeaders.push(DOMAIN_MATCH_HEADER);
    bannerParts.push(
      `<div class="banner">Domain match: ${stats.matched.toLocaleString()} matched, ` +
        `${stats.notMatched.toLocaleString()} not matched, ${stats.missing.toLocaleString()} missing data.</div>`
    );
  }

  if (el.duplicateToggle.checked) {
    const { statuses, stats } = runDuplicateEmailCheck(rows, el.emailSelect.value);
    ({ headers, rows } = withStatusColumn(headers, rows, DUPLICATE_STATUS_HEADER, statuses));
    statusHeaders.push(DUPLICATE_STATUS_HEADER);
    bannerParts.push(
      `<div class="banner">Duplicate email: ${stats.duplicate.toLocaleString()} duplicate, ` +
        `${stats.unique.toLocaleString()} unique, ${stats.missing.toLocaleString()} missing email.</div>`
    );
  }

  state.resultHeaders = headers;
  state.resultRows = rows;
  state.statusHeaders = statusHeaders;

  showBanner(bannerParts.join(""));
  renderResults();
});

function renderResults() {
  const headers = state.resultHeaders;
  el.resultsThead.innerHTML = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;

  const previewRows = state.resultRows.slice(0, TABLE_PREVIEW_LIMIT);
  el.resultsTbody.innerHTML = previewRows
    .map((row) => {
      const cells = headers
        .map((h) => {
          const isStatus = state.statusHeaders.includes(h);
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
  return `${stem}-quality-checked`;
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
      state.statusHeaders.forEach((h) => map.set(h, statusColorKey(row[h])));
      return map;
    });
    await downloadCellHighlightedXlsx(
      state.resultHeaders,
      state.resultRows,
      cellHighlights,
      `${exportBaseName()}.xlsx`,
      "Quality checked"
    );
  } finally {
    el.exportBtn.disabled = false;
    el.exportBtn.textContent = originalLabel;
  }
});

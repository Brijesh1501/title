import { mountSidebar } from "../components/sidebar.js";
import {
  fetchPhoneHeaderRules,
  fetchPhonePatternRules,
  buildPhoneMatchers,
  normalizePhoneValueWithRules,
  normalizePhoneRowsWithRules
} from "../lib/phoneUtils.js";
import { downloadCsv, parseCsvFile } from "../lib/csv.js";

mountSidebar("phone-formatter.html");

const state = {
  headerNames: null,
  matchers: null,
  uploadedRows: null,
  matchedHeaders: [],
  fileName: "",
  textResult: []
};

const el = {
  banner: document.getElementById("banner"),
  fileInput: document.getElementById("file-input"),
  clearBtn: document.getElementById("clear-upload-btn"),
  textarea: document.getElementById("phones-textarea"),
  uploadHint: document.getElementById("upload-hint"),
  formatBtn: document.getElementById("format-btn"),
  resultsBlock: document.getElementById("results-block"),
  resultsThead: document.getElementById("results-thead"),
  resultsTbody: document.getElementById("results-tbody"),
  exportBtn: document.getElementById("export-btn")
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

async function init() {
  try {
    const [headerRules, patternRules] = await Promise.all([fetchPhoneHeaderRules(), fetchPhonePatternRules()]);

    state.headerNames = headerRules.map((r) => r.header_name);
    state.matchers = buildPhoneMatchers(patternRules);

    if (!state.matchers.length) {
      errorBanner(
        "No active number patterns are configured. Add at least one on the Manage Phone " +
          "Rules page before formatting numbers."
      );
      return;
    }
    if (!state.headerNames.length) {
      showBanner(
        `<div class="banner">No CSV header rules are configured, so CSV upload won't match any ` +
          `columns — pasted text below will still work. Add a header on the ` +
          `<a href="admin-phones.html">Manage Phone Rules</a> page to enable CSV mode.</div>`
      );
    }

    el.formatBtn.disabled = false;
    el.formatBtn.textContent = "Format numbers";
  } catch (err) {
    errorBanner(
      `Couldn't load phone rules from Supabase: ${err.message}. Confirm js/config.js is ` +
        `filled in and that supabase/phone_schema.sql has been run.`
    );
  }
}

el.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!state.matchers) return;
  state.fileName = file.name;
  const rows = await parseCsvFile(file);
  const { rows: nextRows, changedCount, matchedHeaders, unmatchedHeaders } = normalizePhoneRowsWithRules(
    rows,
    state.headerNames,
    state.matchers
  );
  state.uploadedRows = nextRows;
  state.matchedHeaders = matchedHeaders;

  el.textarea.style.display = "none";
  el.formatBtn.style.display = "none";
  el.clearBtn.style.display = "";
  el.uploadHint.style.display = "";
  el.uploadHint.textContent =
    matchedHeaders.length > 0
      ? `Formatted ${changedCount} cell(s) across column(s): ${matchedHeaders.join(", ")}.`
      : `None of the configured header(s) (${state.headerNames.join(", ") || "none configured"}) were found in ${state.fileName}.`;

  if (unmatchedHeaders.length) {
    showBanner(
      `<div class="banner">${unmatchedHeaders.length} configured header rule(s) weren't found as a column in ` +
        `this file: ${unmatchedHeaders.map(escapeHtml).join(", ")}. That's expected if this file just doesn't ` +
        `include those columns — but if one of them should be here, check for a typo in ` +
        `<a href="admin-phones.html">Manage Phone Rules</a> or in the file's own column header (matching ` +
        `ignores case and spacing, but the rest of the text must match exactly).</div>`
    );
  } else {
    showBanner("");
  }

  renderUploadedTable();
});

el.clearBtn.addEventListener("click", () => {
  state.uploadedRows = null;
  state.matchedHeaders = [];
  state.fileName = "";
  el.fileInput.value = "";
  el.textarea.style.display = "";
  el.formatBtn.style.display = "";
  el.clearBtn.style.display = "none";
  el.uploadHint.style.display = "none";
  el.resultsBlock.style.display = "none";
});

el.formatBtn.addEventListener("click", () => {
  if (!state.matchers) return;
  const lines = el.textarea.value.split("\n");
  state.textResult = lines.map((line) => normalizePhoneValueWithRules(line, state.matchers));
  renderTextTable();
});

function renderUploadedTable() {
  const headers = Object.keys(state.uploadedRows[0] || {});
  el.resultsThead.innerHTML = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  el.resultsTbody.innerHTML = state.uploadedRows
    .slice(0, 200)
    .map((row) => {
      const cells = headers
        .map((h) => {
          const cls = state.matchedHeaders.includes(h) ? ' class="cell-mono"' : "";
          return `<td${cls}>${escapeHtml(row[h])}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  el.resultsBlock.style.display = "";
}

function renderTextTable() {
  el.resultsThead.innerHTML = `<tr><th>Formatted value</th></tr>`;
  el.resultsTbody.innerHTML = state.textResult
    .map((line) => `<tr><td class="cell-mono">${escapeHtml(line)}</td></tr>`)
    .join("");
  el.resultsBlock.style.display = "";
}

el.exportBtn.addEventListener("click", () => {
  if (state.uploadedRows) {
    downloadCsv(state.uploadedRows, state.fileName ? `formatted-${state.fileName}` : "formatted-phones.csv");
  } else {
    downloadCsv(
      state.textResult.map((line) => ({ value: line })),
      "formatted-phones.csv"
    );
  }
});

init();
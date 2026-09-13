import { mountSidebar } from "../components/sidebar.js";
import { fetchTaxonomyRules, categorizeTitles } from "../lib/titleTaxonomy.js";
import { downloadCsv, parseCsvFile } from "../lib/csv.js";

mountSidebar("job-title-categorizer.html");

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
  exportBtn: document.getElementById("export-btn")
};

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
  state.uploadedRows = await parseCsvFile(file);
  state.titleColumn =
    Object.keys(state.uploadedRows[0] || {}).find((h) => h.trim().toLowerCase() === "title") ||
    Object.keys(state.uploadedRows[0] || {})[0] ||
    null;

  el.textarea.style.display = "none";
  el.clearBtn.style.display = "";
  el.uploadHint.style.display = "";
  el.uploadHint.textContent = `Loaded ${state.uploadedRows.length} rows from ${state.fileName}. Using column "${state.titleColumn}" as the title field.`;
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

el.categorizeBtn.addEventListener("click", () => {
  if (!state.ruleSets) return;

  if (state.uploadedRows && state.titleColumn) {
    const titles = state.uploadedRows.map((r) => r[state.titleColumn]);
    state.results = categorizeTitles(titles, state.ruleSets);
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
});

function renderResults(headers, rows, resultsForHighlight) {
  el.resultsThead.innerHTML = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;

  el.resultsTbody.innerHTML = rows
    .map((row, i) => {
      const highlight = resultsForHighlight[i]?.highlight;
      const rowClass = highlight ? ` class="row-highlight-${highlight}"` : "";
      const cells = headers.map((h) => `<td>${escapeHtml(row[h])}</td>`).join("");
      return `<tr${rowClass}>${cells}</tr>`;
    })
    .join("");

  el.resultsBlock.style.display = "";
}

el.exportBtn.addEventListener("click", () => {
  if (state.uploadedRows) {
    downloadCsv(state.uploadedRows, state.fileName ? `categorized-${state.fileName}` : "categorized-titles.csv");
  } else {
    const rows = state.results.map((r) => ({
      Title: r.title,
      "Responsibility Area": r.respArea,
      "Title Level": r.titleLevel,
      "Department Function": r.deptFunction
    }));
    downloadCsv(rows, "categorized-titles.csv");
  }
});

init();

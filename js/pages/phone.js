import { mountSidebar } from "../components/sidebar.js";
import { normalizeUSPhone, normalizePhoneRows } from "../lib/phoneUtils.js";
import { downloadCsv, parseCsvFile } from "../lib/csv.js";

mountSidebar("phone-formatter.html");

const state = {
  uploadedRows: null,
  matchedHeaders: [],
  fileName: "",
  textResult: []
};

const el = {
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

el.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  state.fileName = file.name;
  const rows = await parseCsvFile(file);
  const { rows: nextRows, changedCount, matchedHeaders } = normalizePhoneRows(rows);
  state.uploadedRows = nextRows;
  state.matchedHeaders = matchedHeaders;

  el.textarea.style.display = "none";
  el.formatBtn.style.display = "none";
  el.clearBtn.style.display = "";
  el.uploadHint.style.display = "";
  el.uploadHint.textContent =
    matchedHeaders.length > 0
      ? `Formatted ${changedCount} cell(s) across column(s): ${matchedHeaders.join(", ")}.`
      : `No "Mobile No." or "Direct No." or "Additional Phone No." column found in ${state.fileName}.`;

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
  const lines = el.textarea.value.split("\n");
  state.textResult = lines.map((line) => normalizeUSPhone(line));
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

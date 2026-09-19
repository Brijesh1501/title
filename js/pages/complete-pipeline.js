import { mountSidebar } from "../components/sidebar.js";
import { fetchFieldMappings } from "../lib/reportSync.js";
import { fetchTaxonomyRules } from "../lib/titleTaxonomy.js";
import { fetchTimezoneLookup, buildLookupMaps } from "../lib/timezoneFill.js";
import { PIPELINE_STEPS, runPipeline, resolveEffectiveHeaders } from "../lib/pipeline.js";
import { downloadCsv, downloadPipelineXlsx, parseCsvFile } from "../lib/csv.js";

mountSidebar("complete-pipeline.html");

const TABLE_PREVIEW_LIMIT = 500;

const state = {
  resourcesLoaded: false,
  resourcesError: null,
  mappings: null, // contact_field_mappings, for report-sync + effective-header resolution
  ruleSets: null, // job_title_rules
  lookupMaps: null, // timezone_lookup
  uploadedHeaders: [],
  uploadedRows: [],
  fileName: "",
  selected: new Set(PIPELINE_STEPS.map((s) => s.id)), // all six selected by default
  result: null // { headers, rows, rowFlags, cellFlags, log }
};

const el = {
  banner: document.getElementById("banner"),
  fileInput: document.getElementById("file-input"),
  clearBtn: document.getElementById("clear-upload-btn"),
  uploadHint: document.getElementById("upload-hint"),
  stepsContainer: document.getElementById("pipeline-steps"),
  runBtn: document.getElementById("run-btn"),
  progressWrap: document.getElementById("progress-wrap"),
  progressFill: document.getElementById("progress-fill"),
  progressText: document.getElementById("progress-text"),
  progressCount: document.getElementById("progress-count"),
  logSection: document.getElementById("log-section"),
  log: document.getElementById("pipeline-log"),
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

function showProgress(text) {
  el.progressWrap.style.display = "";
  el.progressText.textContent = text;
  el.progressFill.style.width = "0%";
  el.progressCount.textContent = "";
}

function hideProgress() {
  el.progressWrap.style.display = "none";
}

function guessHeader(headers, exact, contains) {
  if (!headers.length) return "";
  const lower = headers.map((h) => h.toLowerCase());
  let i = lower.indexOf(exact.toLowerCase());
  if (i === -1) i = lower.findIndex((h) => h.includes(contains.toLowerCase()));
  return i === -1 ? headers[0] : headers[i];
}

function optionsHtml(headers, selected) {
  return headers.map((h) => `<option value="${escapeHtml(h)}" ${h === selected ? "selected" : ""}>${escapeHtml(h)}</option>`).join("");
}

// ---------------------------------------------------------------------------
// Resource loading — every step's Supabase-backed data is fetched up front so
// toggling steps on/off never has to wait on a network call.
// ---------------------------------------------------------------------------

async function loadResources() {
  try {
    const [mappings, ruleSets, timezoneRows] = await Promise.all([
      fetchFieldMappings(),
      fetchTaxonomyRules(),
      fetchTimezoneLookup()
    ]);
    state.mappings = mappings;
    state.ruleSets = ruleSets;
    state.lookupMaps = buildLookupMaps(timezoneRows);
    state.resourcesLoaded = true;
  } catch (err) {
    state.resourcesError = err;
    errorBanner(
      `Couldn't load the data these tools depend on: ${err.message}. Confirm js/config.js is ` +
        `filled in and that supabase/schema.sql, supabase/timezone_schema.sql (+ seed) have been run.`
    );
  }
  updateRunButtonState();
}

// ---------------------------------------------------------------------------
// Step configuration panels
// ---------------------------------------------------------------------------

function effectiveHeaders() {
  return resolveEffectiveHeaders(state.uploadedHeaders, state.selected.has("report-sync"), state.mappings || []);
}

function renderSteps() {
  el.stepsContainer.innerHTML = PIPELINE_STEPS.map((step, i) => renderStepCard(step, i + 1)).join("");
  PIPELINE_STEPS.forEach((step) => {
    const checkbox = document.getElementById(`step-toggle-${step.id}`);
    checkbox.addEventListener("change", () => onStepToggle(step.id, checkbox.checked));
  });
  attachConfigListeners();
  refreshColumnSelectors();
}

function renderStepCard(step, index) {
  const checked = state.selected.has(step.id) ? "checked" : "";
  const selectedClass = state.selected.has(step.id) ? " is-selected" : "";
  return `
    <div class="pipeline-step${selectedClass}" data-step="${step.id}">
      <div class="pipeline-step-header">
        <div class="pipeline-step-index">${index}</div>
        <label class="pipeline-step-toggle">
          <input type="checkbox" id="step-toggle-${step.id}" ${checked} />
          <span>
            <span class="pipeline-step-title">${escapeHtml(step.label)}</span>
            <p class="pipeline-step-desc">${escapeHtml(step.description)}</p>
          </span>
        </label>
      </div>
      <div class="pipeline-step-config">${renderStepConfig(step.id)}</div>
    </div>
  `;
}

function renderStepConfig(stepId) {
  switch (stepId) {
    case "report-sync":
      return `<p class="hint" style="margin: 0">Uses the field mapping stored in Supabase (see <a href="admin-mappings.html">Manage Field Mapping</a>). No options to set here.</p>`;

    case "highlight-latest":
      return `
        <div class="config-grid">
          <div class="field-group">
            <label class="field-group-label" for="hl-website-select">Website column</label>
            <select class="select-input" id="hl-website-select"></select>
          </div>
          <div class="field-group">
            <label class="field-group-label">Find the latest row by</label>
            <div class="radio-group">
              <label class="radio-option"><input type="radio" name="hl-mode" value="created_date" checked /> Created Date column</label>
              <label class="radio-option"><input type="radio" name="hl-mode" value="campaign_name" /> Campaign Name text</label>
            </div>
          </div>
        </div>
        <div id="hl-created-date-panel">
          <div class="config-grid">
            <div class="field-group">
              <label class="field-group-label" for="hl-date-select">Date column</label>
              <select class="select-input" id="hl-date-select"></select>
            </div>
            <div class="field-group">
              <label class="field-group-label">Date format</label>
              <div class="radio-group">
                <label class="radio-option"><input type="radio" name="hl-date-format" value="dmy" checked /> DD/MM/YYYY</label>
                <label class="radio-option"><input type="radio" name="hl-date-format" value="mdy" /> MM/DD/YYYY</label>
              </div>
            </div>
          </div>
        </div>
        <div id="hl-campaign-panel" style="display: none">
          <div class="config-grid">
            <div class="field-group">
              <label class="field-group-label" for="hl-campaign-select">Campaign Name column</label>
              <select class="select-input" id="hl-campaign-select"></select>
            </div>
          </div>
        </div>
      `;

    case "job-title":
      return `
        <div class="config-grid">
          <div class="field-group">
            <label class="field-group-label" for="jt-title-select">Title column</label>
            <select class="select-input" id="jt-title-select"></select>
          </div>
        </div>
        <p class="hint" style="margin: 8px 0 0">
          Rules come from Supabase (see <a href="admin-rules.html">Manage Rules</a>).
        </p>
      `;

    case "phone-format":
      return `<p class="hint" style="margin: 0">Automatically finds "Mobile No." and "Direct No." columns by name. No options to set here.</p>`;

    case "location-fill":
      return `
        <label class="radio-option">
          <input type="checkbox" id="lf-match-city" checked />
          Also match by City when available (falls back to State, then Country)
        </label>
        <p class="hint" style="margin: 8px 0 0">
          Uses the lookup table stored in Supabase (see <a href="admin-timezones.html">Manage Timezone Lookup</a>).
        </p>
      `;

    case "data-quality":
      return `
        <div class="config-grid">
          <div class="field-group">
            <label class="radio-option"><input type="checkbox" id="dq-domain-check" checked /> Check Website ↔ Email domain match</label>
          </div>
          <div class="field-group">
            <label class="radio-option"><input type="checkbox" id="dq-duplicate-check" checked /> Check for duplicate email addresses</label>
          </div>
        </div>
        <div class="config-grid">
          <div class="field-group">
            <label class="field-group-label" for="dq-website-select">Website column</label>
            <select class="select-input" id="dq-website-select"></select>
          </div>
          <div class="field-group">
            <label class="field-group-label" for="dq-email-select">Email Address column</label>
            <select class="select-input" id="dq-email-select"></select>
          </div>
        </div>
      `;

    default:
      return "";
  }
}

function attachConfigListeners() {
  document.querySelectorAll('input[name="hl-mode"]').forEach((input) => {
    input.addEventListener("change", () => {
      const mode = document.querySelector('input[name="hl-mode"]:checked').value;
      document.getElementById("hl-created-date-panel").style.display = mode === "created_date" ? "" : "none";
      document.getElementById("hl-campaign-panel").style.display = mode === "campaign_name" ? "" : "none";
    });
  });
}

function onStepToggle(stepId, checked) {
  if (checked) state.selected.add(stepId);
  else state.selected.delete(stepId);

  document.querySelector(`[data-step="${stepId}"]`).classList.toggle("is-selected", checked);

  // Toggling report-sync changes what headers every later step sees, so their
  // column pickers need to be rebuilt against the new effective header set.
  if (stepId === "report-sync") refreshColumnSelectors();

  updateRunButtonState();
}

// Repopulates every column <select> with the current effective headers,
// keeping the previous selection if it's still valid, or re-guessing otherwise.
function refreshColumnSelectors() {
  const headers = effectiveHeaders();
  if (!headers.length) return;

  const selects = [
    { id: "hl-website-select", exact: "Website", contains: "website" },
    { id: "hl-date-select", exact: "Created Date", contains: "date" },
    { id: "hl-campaign-select", exact: "Campaign Name", contains: "campaign" },
    { id: "jt-title-select", exact: "Title", contains: "title" },
    { id: "dq-website-select", exact: "Website", contains: "website" },
    { id: "dq-email-select", exact: "Email Address", contains: "email" }
  ];

  selects.forEach(({ id, exact, contains }) => {
    const select = document.getElementById(id);
    if (!select) return;
    const previous = select.value;
    const fallback = guessHeader(headers, exact, contains);
    const selected = headers.includes(previous) ? previous : fallback;
    select.innerHTML = optionsHtml(headers, selected);
  });
}

function updateRunButtonState() {
  const ready = state.resourcesLoaded && state.uploadedRows.length > 0 && state.selected.size > 0;
  el.runBtn.disabled = !ready;

  if (!state.resourcesLoaded) el.runBtn.textContent = state.resourcesError ? "Couldn't load required data" : "Loading tool data…";
  else if (!state.uploadedRows.length) el.runBtn.textContent = "Upload a CSV to continue";
  else if (!state.selected.size) el.runBtn.textContent = "Select at least one pass to run";
  else el.runBtn.textContent = "Run pipeline";
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

el.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  state.fileName = file.name;

  showProgress("Reading CSV…");
  el.resultsBlock.style.display = "none";
  el.logSection.style.display = "none";
  showBanner("");

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

  state.uploadedHeaders = Object.keys(rows[0]);
  state.uploadedRows = rows;

  el.clearBtn.style.display = "";
  el.uploadHint.style.display = "";
  el.uploadHint.textContent = `Loaded ${rows.length.toLocaleString()} rows and ${state.uploadedHeaders.length} column(s) from ${state.fileName}.`;

  refreshColumnSelectors();
  updateRunButtonState();
});

el.clearBtn.addEventListener("click", () => {
  state.uploadedHeaders = [];
  state.uploadedRows = [];
  state.fileName = "";
  state.result = null;
  el.fileInput.value = "";
  el.clearBtn.style.display = "none";
  el.uploadHint.style.display = "none";
  el.resultsBlock.style.display = "none";
  el.logSection.style.display = "none";
  showBanner("");
  updateRunButtonState();
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function currentStepOptions() {
  const headers = effectiveHeaders();
  const hlMode = document.querySelector('input[name="hl-mode"]:checked')?.value || "created_date";
  const hlDateFormat = document.querySelector('input[name="hl-date-format"]:checked')?.value || "dmy";

  return {
    "highlight-latest": {
      websiteHeader: document.getElementById("hl-website-select")?.value || guessHeader(headers, "Website", "website"),
      mode: hlMode,
      dateHeader: document.getElementById("hl-date-select")?.value || guessHeader(headers, "Created Date", "date"),
      dateFormat: hlDateFormat,
      campaignHeader: document.getElementById("hl-campaign-select")?.value || guessHeader(headers, "Campaign Name", "campaign")
    },
    "job-title": {
      titleColumn: document.getElementById("jt-title-select")?.value || null
    },
    "location-fill": {
      matchByCity: document.getElementById("lf-match-city")?.checked !== false
    },
    "data-quality": {
      websiteHeader: document.getElementById("dq-website-select")?.value || guessHeader(headers, "Website", "website"),
      emailHeader: document.getElementById("dq-email-select")?.value || guessHeader(headers, "Email Address", "email"),
      runDomainCheck: document.getElementById("dq-domain-check")?.checked !== false,
      runDuplicateCheck: document.getElementById("dq-duplicate-check")?.checked !== false
    }
  };
}

function renderLogSkeleton() {
  const orderedSelected = PIPELINE_STEPS.filter((s) => state.selected.has(s.id));
  el.log.innerHTML = orderedSelected
    .map(
      (s) => `
        <li class="pipeline-log-item" data-log="${s.id}">
          <span class="pipeline-log-status">…</span>
          <div>
            <div class="pipeline-log-label">${escapeHtml(s.label)}</div>
            <div class="pipeline-log-summary">Waiting…</div>
          </div>
        </li>
      `
    )
    .join("");
  el.logSection.style.display = "";
}

function markStepRunning(step) {
  const item = document.querySelector(`[data-log="${step.id}"]`);
  if (!item) return;
  item.querySelector(".pipeline-log-status").textContent = "⏳";
  item.querySelector(".pipeline-log-status").classList.add("is-running");
  item.querySelector(".pipeline-log-summary").textContent = "Running…";
}

function markStepDone(step, entry) {
  const item = document.querySelector(`[data-log="${step.id}"]`);
  if (!item) return;
  const status = item.querySelector(".pipeline-log-status");
  status.textContent = "✓";
  status.classList.remove("is-running");
  status.classList.add("is-done");
  item.querySelector(".pipeline-log-summary").textContent = entry.summary;
  if (entry.warnings.length) {
    const warn = document.createElement("div");
    warn.className = "pipeline-log-warning";
    warn.textContent = entry.warnings.join(" ");
    item.appendChild(warn);
  }
}

el.runBtn.addEventListener("click", async () => {
  el.runBtn.disabled = true;
  const originalLabel = el.runBtn.textContent;
  el.runBtn.textContent = "Running pipeline…";
  el.resultsBlock.style.display = "none";
  showBanner("");
  renderLogSkeleton();

  try {
    const resources = {
      reportSync: { mappings: state.mappings },
      jobTitle: { ruleSets: state.ruleSets },
      locationFill: { lookupMaps: state.lookupMaps }
    };

    const result = await runPipeline(state.uploadedHeaders, state.uploadedRows, state.selected, resources, currentStepOptions(), {
      onStepStart: (step) => {
        markStepRunning(step);
        if (step.id === "job-title") showProgress("Categorizing titles…");
      },
      onStepComplete: (step, entry) => {
        markStepDone(step, entry);
        if (step.id === "job-title") hideProgress();
      },
      onTitleProgress: (p) => {
        el.progressFill.style.width = `${p.percent ?? 0}%`;
        el.progressCount.textContent = `${p.done.toLocaleString()} / ${p.total.toLocaleString()}`;
      }
    });

    state.result = result;

    if (!result.log.length) {
      errorBanner("No passes were selected, so nothing ran.");
    } else {
      renderResults();
    }
  } catch (err) {
    errorBanner(`Pipeline stopped: ${err.message}`);
  } finally {
    hideProgress();
    el.runBtn.disabled = false;
    el.runBtn.textContent = originalLabel;
    updateRunButtonState();
  }
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function renderResults() {
  const { headers, rows, rowFlags, cellFlags } = state.result;

  el.resultsThead.innerHTML = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;

  const previewRows = rows.slice(0, TABLE_PREVIEW_LIMIT);
  el.resultsTbody.innerHTML = previewRows
    .map((row, i) => {
      const flag = rowFlags[i] || {};
      const rowKey = flag.latest ? "latest" : flag.category || null;
      const rowClass = rowKey ? ` class="row-highlight-${rowKey}"` : "";

      const cellMap = cellFlags[i];
      const cells = headers
        .map((h) => {
          const cellKey = cellMap && cellMap.get(h);
          const cellClass = cellKey ? (cellKey === "filled" ? ` class="cell-filled"` : ` class="status-${cellKey}"`) : "";
          return `<td${cellClass}>${escapeHtml(row[h])}</td>`;
        })
        .join("");

      return `<tr${rowClass}>${cells}</tr>`;
    })
    .join("");

  if (rows.length > TABLE_PREVIEW_LIMIT) {
    el.tableNote.style.display = "";
    el.tableNote.textContent = `Showing the first ${TABLE_PREVIEW_LIMIT.toLocaleString()} of ${rows.length.toLocaleString()} rows. Both downloads include all ${rows.length.toLocaleString()} rows.`;
  } else {
    el.tableNote.style.display = "none";
  }

  el.resultsBlock.style.display = "";
}

function exportBaseName() {
  const stem = state.fileName ? state.fileName.replace(/\.csv$/i, "") : "contacts";
  return `${stem}-pipeline`;
}

el.exportCsvBtn.addEventListener("click", () => {
  if (!state.result) return;
  downloadCsv(state.result.rows, `${exportBaseName()}.csv`);
});

el.exportBtn.addEventListener("click", async () => {
  if (!state.result) return;
  const originalLabel = el.exportBtn.textContent;
  el.exportBtn.disabled = true;
  el.exportBtn.textContent = "Building Excel file…";
  try {
    const { headers, rows, rowFlags, cellFlags } = state.result;
    await downloadPipelineXlsx(headers, rows, rowFlags, cellFlags, `${exportBaseName()}.xlsx`, "Pipeline result");
  } finally {
    el.exportBtn.disabled = false;
    el.exportBtn.textContent = originalLabel;
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

renderSteps();
updateRunButtonState();
loadResources();

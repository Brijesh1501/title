import { mountSidebar } from "../components/sidebar.js";
import { requireSession } from "../components/auth-guard.js";
import { supabase } from "../supabaseClient.js";

mountSidebar("admin-phones.html");

const el = {
  pageContent: document.getElementById("page-content"),
  loadingState: document.getElementById("loading-state"),
  banner: document.getElementById("phones-banner"),
  headersTbody: document.getElementById("headers-tbody"),
  headersNewRow: document.getElementById("headers-new-row"),
  patternsTbody: document.getElementById("patterns-tbody"),
  patternsNewRow: document.getElementById("patterns-new-row")
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function showBanner(message, isError = true) {
  el.banner.innerHTML = message
    ? `<div class="banner ${isError ? "banner--error" : ""}">${escapeHtml(message)}</div>`
    : "";
}

function friendlyError(error, kind) {
  if (error?.code === "23505") {
    return kind === "header"
      ? "A rule for that exact header name already exists."
      : "Something with the same details already exists.";
  }
  return error?.message || "Something went wrong.";
}

// ---------- Headers to scan ----------

function renderHeaderRow(rule) {
  return `
    <tr data-id="${rule.id}">
      <td><input class="cell-input" data-field="header_name" value="${escapeHtml(rule.header_name)}" /></td>
      <td><input type="checkbox" data-field="is_active" ${rule.is_active ? "checked" : ""} /></td>
      <td class="rule-actions">
        <button class="btn-secondary btn-small" data-action="save-header">Save</button>
        <button class="btn-ghost btn-small" data-action="delete-header">Delete</button>
      </td>
    </tr>
  `;
}

function renderHeaderNewRow() {
  return `
    <tr class="row-new">
      <td><input class="cell-input" data-field="header_name" placeholder="e.g. Work Phone" /></td>
      <td></td>
      <td><button class="btn-primary btn-small" data-action="add-header">Add header</button></td>
    </tr>
  `;
}

async function loadHeaderRules() {
  const { data, error } = await supabase.from("phone_header_rules").select("*").order("header_name", { ascending: true });
  if (error) {
    showBanner(friendlyError(error, "header"));
    return;
  }
  el.headersTbody.innerHTML = data.map(renderHeaderRow).join("");
  el.headersNewRow.innerHTML = renderHeaderNewRow();
}

function readRowValues(row) {
  const values = {};
  row.querySelectorAll("[data-field]").forEach((input) => {
    values[input.dataset.field] = input.type === "checkbox" ? input.checked : input.value.trim();
  });
  return values;
}

async function saveHeaderRule(id, row) {
  const values = readRowValues(row);
  if (!values.header_name) {
    showBanner("A header name is required.");
    return;
  }
  const { error } = await supabase
    .from("phone_header_rules")
    .update({ header_name: values.header_name, is_active: !!values.is_active })
    .eq("id", id);

  if (error) showBanner(friendlyError(error, "header"));
  else {
    showBanner("Header rule saved.", false);
    loadHeaderRules();
  }
}

async function deleteHeaderRule(id) {
  if (!window.confirm("Delete this header rule? This can't be undone.")) return;
  const { error } = await supabase.from("phone_header_rules").delete().eq("id", id);
  if (error) showBanner(friendlyError(error, "header"));
  else loadHeaderRules();
}

async function addHeaderRule(row) {
  const values = readRowValues(row);
  if (!values.header_name) {
    showBanner("A new header rule needs a header name.");
    return;
  }
  const { error } = await supabase.from("phone_header_rules").insert({ header_name: values.header_name, is_active: true });
  if (error) showBanner(friendlyError(error, "header"));
  else {
    showBanner("Header rule added.", false);
    loadHeaderRules();
  }
}

// ---------- Number patterns ----------

function renderPatternRow(rule) {
  const groupSizes = (rule.group_sizes || []).join(",");
  return `
    <tr data-id="${rule.id}">
      <td><input class="cell-input" data-field="label" value="${escapeHtml(rule.label)}" /></td>
      <td><input class="cell-input" data-field="country_code" value="${escapeHtml(rule.country_code)}" placeholder="e.g. 1" /></td>
      <td><input class="cell-input" data-field="group_sizes" value="${escapeHtml(groupSizes)}" placeholder="3,3,4" /></td>
      <td><input class="cell-input" data-field="separator" value="${escapeHtml(rule.separator)}" /></td>
      <td><input class="cell-input cell-input--narrow" type="number" data-field="priority" value="${rule.priority}" /></td>
      <td><input type="checkbox" data-field="is_active" ${rule.is_active ? "checked" : ""} /></td>
      <td class="rule-actions">
        <button class="btn-secondary btn-small" data-action="save-pattern">Save</button>
        <button class="btn-ghost btn-small" data-action="delete-pattern">Delete</button>
      </td>
    </tr>
  `;
}

function renderPatternNewRow() {
  return `
    <tr class="row-new">
      <td><input class="cell-input" data-field="label" placeholder="e.g. India mobile" /></td>
      <td><input class="cell-input" data-field="country_code" placeholder="e.g. 91" /></td>
      <td><input class="cell-input" data-field="group_sizes" placeholder="5,5" /></td>
      <td><input class="cell-input" data-field="separator" placeholder="-" value="-" /></td>
      <td><input class="cell-input cell-input--narrow" type="number" data-field="priority" value="100" /></td>
      <td></td>
      <td><button class="btn-primary btn-small" data-action="add-pattern">Add pattern</button></td>
    </tr>
  `;
}

async function loadPatternRules() {
  const { data, error } = await supabase.from("phone_number_patterns").select("*").order("priority", { ascending: true });
  if (error) {
    showBanner(friendlyError(error, "pattern"));
    return;
  }
  el.patternsTbody.innerHTML = data.map(renderPatternRow).join("");
  el.patternsNewRow.innerHTML = renderPatternNewRow();
}

// Turns "3, 3, 4" / "3,3,4" into [3,3,4]; returns null if it's not a clean list of positive integers.
function parseGroupSizes(text) {
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (!parts.length) return null;
  const sizes = parts.map((p) => Number(p));
  if (sizes.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  return sizes;
}

async function savePatternRule(id, row) {
  const values = readRowValues(row);
  const groupSizes = parseGroupSizes(values.group_sizes);

  if (!values.label) {
    showBanner("A label is required.");
    return;
  }
  if (!groupSizes) {
    showBanner('Digit groups must be a comma-separated list of positive whole numbers, e.g. "3,3,4".');
    return;
  }

  const { error } = await supabase
    .from("phone_number_patterns")
    .update({
      label: values.label,
      country_code: values.country_code.replace(/\D/g, ""),
      group_sizes: groupSizes,
      separator: values.separator || "-",
      priority: Number(values.priority) || 100,
      is_active: !!values.is_active
    })
    .eq("id", id);

  if (error) showBanner(friendlyError(error, "pattern"));
  else {
    showBanner("Pattern saved.", false);
    loadPatternRules();
  }
}

async function deletePatternRule(id) {
  if (!window.confirm("Delete this number pattern? This can't be undone.")) return;
  const { error } = await supabase.from("phone_number_patterns").delete().eq("id", id);
  if (error) showBanner(friendlyError(error, "pattern"));
  else loadPatternRules();
}

async function addPatternRule(row) {
  const values = readRowValues(row);
  const groupSizes = parseGroupSizes(values.group_sizes);

  if (!values.label) {
    showBanner("A new pattern needs a label.");
    return;
  }
  if (!groupSizes) {
    showBanner('Digit groups must be a comma-separated list of positive whole numbers, e.g. "3,3,4".');
    return;
  }

  const { error } = await supabase.from("phone_number_patterns").insert({
    label: values.label,
    country_code: values.country_code.replace(/\D/g, ""),
    group_sizes: groupSizes,
    separator: values.separator || "-",
    priority: Number(values.priority) || 100,
    is_active: true
  });

  if (error) showBanner(friendlyError(error, "pattern"));
  else {
    showBanner("Pattern added.", false);
    loadPatternRules();
  }
}

// ---------- event delegation ----------

document.body.addEventListener("click", (e) => {
  const button = e.target.closest("[data-action]");
  if (!button) return;

  const row = button.closest("tr");
  const action = button.dataset.action;

  if (action === "save-header") saveHeaderRule(row.dataset.id, row);
  else if (action === "delete-header") deleteHeaderRule(row.dataset.id);
  else if (action === "add-header") addHeaderRule(row);
  else if (action === "save-pattern") savePatternRule(row.dataset.id, row);
  else if (action === "delete-pattern") deletePatternRule(row.dataset.id);
  else if (action === "add-pattern") addPatternRule(row);
});

// ---------- boot ----------

requireSession().then(() => {
  el.loadingState.style.display = "none";
  el.pageContent.style.display = "";
  loadHeaderRules();
  loadPatternRules();
});

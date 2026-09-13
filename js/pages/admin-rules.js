import { mountSidebar } from "../components/sidebar.js";
import { requireSession } from "../components/auth-guard.js";
import { supabase } from "../supabaseClient.js";

mountSidebar("admin-rules.html");

const el = {
  pageContent: document.getElementById("page-content"),
  loadingState: document.getElementById("loading-state"),
  banner: document.getElementById("rules-banner"),
  titleLevelBody: document.getElementById("title-level-tbody"),
  titleLevelNewRow: document.getElementById("title-level-new-row"),
  respAreaBody: document.getElementById("responsibility-area-tbody"),
  respAreaNewRow: document.getElementById("responsibility-area-new-row")
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

function keywordsToText(keywords) {
  return Array.isArray(keywords) ? keywords.join(", ") : keywords || "";
}

function textToKeywords(text) {
  return String(text)
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// ---------- rendering ----------

function renderRuleRow(rule, hasDeptFunction) {
  const deptCell = hasDeptFunction
    ? `<td><input class="cell-input" data-field="dept_function" value="${escapeHtml(rule.dept_function || "")}" /></td>`
    : "";

  return `
    <tr data-id="${rule.id}" class="${rule.is_active ? "" : "row-inactive"}">
      <td><input class="cell-input cell-input--narrow" type="number" data-field="priority" value="${rule.priority}" /></td>
      <td><input class="cell-input" data-field="label" value="${escapeHtml(rule.label)}" /></td>
      ${deptCell}
      <td><input class="cell-input" data-field="keywords" value="${escapeHtml(keywordsToText(rule.keywords))}" /></td>
      <td><input type="checkbox" data-field="is_active" ${rule.is_active ? "checked" : ""} /></td>
      <td class="rule-actions">
        <button class="btn-secondary btn-small" data-action="save">Save</button>
        <button class="btn-ghost btn-small" data-action="delete">Delete</button>
      </td>
    </tr>
  `;
}

function renderNewRow(ruleType, hasDeptFunction) {
  const deptCell = hasDeptFunction
    ? `<td><input class="cell-input" data-field="dept_function" placeholder="e.g. IT & Engineering" /></td>`
    : "";

  return `
    <tr class="row-new" data-rule-type="${ruleType}">
      <td><input class="cell-input cell-input--narrow" type="number" data-field="priority" value="100" /></td>
      <td><input class="cell-input" data-field="label" placeholder="e.g. Manager" /></td>
      ${deptCell}
      <td><input class="cell-input" data-field="keywords" placeholder="e.g. manager, gm, general manager" /></td>
      <td></td>
      <td><button class="btn-primary btn-small" data-action="add">Add rule</button></td>
    </tr>
  `;
}

function readRowValues(row) {
  const values = {};
  row.querySelectorAll("[data-field]").forEach((input) => {
    const field = input.dataset.field;
    if (input.type === "checkbox") values[field] = input.checked;
    else values[field] = input.value;
  });
  return values;
}

// ---------- data ----------

async function loadRules() {
  const { data, error } = await supabase
    .from("job_title_rules")
    .select("*")
    .order("rule_type", { ascending: true })
    .order("priority", { ascending: true });

  if (error) {
    showBanner(error.message);
    return;
  }

  const titleLevelRules = data.filter((r) => r.rule_type === "title_level");
  const respAreaRules = data.filter((r) => r.rule_type === "responsibility_area");

  el.titleLevelBody.innerHTML = titleLevelRules.map((r) => renderRuleRow(r, false)).join("");
  el.titleLevelNewRow.innerHTML = renderNewRow("title_level", false);

  el.respAreaBody.innerHTML = respAreaRules.map((r) => renderRuleRow(r, true)).join("");
  el.respAreaNewRow.innerHTML = renderNewRow("responsibility_area", true);
}

async function saveRule(id, row) {
  const values = readRowValues(row);
  const { error } = await supabase
    .from("job_title_rules")
    .update({
      label: values.label,
      dept_function: values.dept_function ?? null,
      priority: Number(values.priority) || 100,
      keywords: textToKeywords(values.keywords),
      is_active: !!values.is_active
    })
    .eq("id", id);

  if (error) showBanner(error.message);
  else {
    showBanner("Rule saved.", false);
    loadRules();
  }
}

async function deleteRule(id) {
  if (!window.confirm("Delete this rule? This can't be undone.")) return;
  const { error } = await supabase.from("job_title_rules").delete().eq("id", id);
  if (error) showBanner(error.message);
  else loadRules();
}

async function addRule(ruleType, row) {
  const values = readRowValues(row);
  if (!values.label?.trim() || !values.keywords?.trim()) {
    showBanner("A new rule needs at least a label and one keyword.");
    return;
  }

  const { error } = await supabase.from("job_title_rules").insert({
    rule_type: ruleType,
    priority: Number(values.priority) || 100,
    label: values.label.trim(),
    dept_function: values.dept_function?.trim() || null,
    keywords: textToKeywords(values.keywords),
    is_active: true
  });

  if (error) showBanner(error.message);
  else {
    showBanner("Rule added.", false);
    loadRules();
  }
}

// ---------- event delegation ----------

document.body.addEventListener("click", (e) => {
  const button = e.target.closest("[data-action]");
  if (!button) return;

  const row = button.closest("tr");
  const action = button.dataset.action;

  if (action === "save") saveRule(row.dataset.id, row);
  else if (action === "delete") deleteRule(row.dataset.id);
  else if (action === "add") addRule(row.dataset.ruleType, row);
});

// ---------- boot ----------

requireSession().then(() => {
  el.loadingState.style.display = "none";
  el.pageContent.style.display = "";
  loadRules();
});

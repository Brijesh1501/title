import { mountSidebar } from "../components/sidebar.js";
import { requireSession } from "../components/auth-guard.js";
import { supabase } from "../supabaseClient.js";

mountSidebar("admin-mappings.html");

const el = {
  pageContent: document.getElementById("page-content"),
  loadingState: document.getElementById("loading-state"),
  banner: document.getElementById("mappings-banner"),
  tbody: document.getElementById("mappings-tbody"),
  newRow: document.getElementById("mappings-new-row")
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

// A unique-constraint violation on report_header (Postgres code 23505) is the
// one error users are likely to hit routinely — give it a friendlier message
// than the raw Postgres text.
function friendlyError(error) {
  if (error?.code === "23505") {
    return "A mapping for that report column already exists. Edit the existing row instead of adding a duplicate.";
  }
  return error?.message || "Something went wrong.";
}

// ---------- rendering ----------

function renderRow(mapping) {
  return `
    <tr data-id="${mapping.id}" class="${mapping.is_active ? "" : "row-inactive"}">
      <td><input class="cell-input cell-input--narrow" type="number" data-field="sort_order" value="${mapping.sort_order}" /></td>
      <td><input class="cell-input" data-field="report_header" value="${escapeHtml(mapping.report_header)}" /></td>
      <td><input class="cell-input" data-field="contact_header" value="${escapeHtml(mapping.contact_header)}" /></td>
      <td><input type="checkbox" data-field="is_active" ${mapping.is_active ? "checked" : ""} /></td>
      <td class="rule-actions">
        <button class="btn-secondary btn-small" data-action="save">Save</button>
        <button class="btn-ghost btn-small" data-action="delete">Delete</button>
      </td>
    </tr>
  `;
}

function renderNewRow() {
  return `
    <tr class="row-new">
      <td><input class="cell-input cell-input--narrow" type="number" data-field="sort_order" value="100" /></td>
      <td><input class="cell-input" data-field="report_header" placeholder="e.g. Contact: Email Address" /></td>
      <td><input class="cell-input" data-field="contact_header" placeholder="e.g. Email Address" /></td>
      <td></td>
      <td><button class="btn-primary btn-small" data-action="add">Add mapping</button></td>
    </tr>
  `;
}

function readRowValues(row) {
  const values = {};
  row.querySelectorAll("[data-field]").forEach((input) => {
    const field = input.dataset.field;
    values[field] = input.type === "checkbox" ? input.checked : input.value;
  });
  return values;
}

// ---------- data ----------

async function loadMappings() {
  const { data, error } = await supabase
    .from("contact_field_mappings")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    showBanner(friendlyError(error));
    return;
  }

  el.tbody.innerHTML = data.map(renderRow).join("");
  el.newRow.innerHTML = renderNewRow();
}

async function saveMapping(id, row) {
  const values = readRowValues(row);
  if (!values.report_header?.trim() || !values.contact_header?.trim()) {
    showBanner("Both a report column and a contact column are required.");
    return;
  }

  const { error } = await supabase
    .from("contact_field_mappings")
    .update({
      report_header: values.report_header.trim(),
      contact_header: values.contact_header.trim(),
      sort_order: Number(values.sort_order) || 100,
      is_active: !!values.is_active
    })
    .eq("id", id);

  if (error) showBanner(friendlyError(error));
  else {
    showBanner("Mapping saved.", false);
    loadMappings();
  }
}

async function deleteMapping(id) {
  if (!window.confirm("Delete this field mapping? This can't be undone.")) return;
  const { error } = await supabase.from("contact_field_mappings").delete().eq("id", id);
  if (error) showBanner(friendlyError(error));
  else loadMappings();
}

async function addMapping(row) {
  const values = readRowValues(row);
  if (!values.report_header?.trim() || !values.contact_header?.trim()) {
    showBanner("A new mapping needs both a report column and a contact column.");
    return;
  }

  const { error } = await supabase.from("contact_field_mappings").insert({
    report_header: values.report_header.trim(),
    contact_header: values.contact_header.trim(),
    sort_order: Number(values.sort_order) || 100,
    is_active: true
  });

  if (error) showBanner(friendlyError(error));
  else {
    showBanner("Mapping added.", false);
    loadMappings();
  }
}

// ---------- event delegation ----------

document.body.addEventListener("click", (e) => {
  const button = e.target.closest("[data-action]");
  if (!button) return;

  const row = button.closest("tr");
  const action = button.dataset.action;

  if (action === "save") saveMapping(row.dataset.id, row);
  else if (action === "delete") deleteMapping(row.dataset.id);
  else if (action === "add") addMapping(row);
});

// ---------- boot ----------

requireSession().then(() => {
  el.loadingState.style.display = "none";
  el.pageContent.style.display = "";
  loadMappings();
});

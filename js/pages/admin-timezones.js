import { mountSidebar } from "../components/sidebar.js";
import { requireSession } from "../components/auth-guard.js";
import { supabase } from "../supabaseClient.js";

mountSidebar("admin-timezones.html");

// The lookup table can hold thousands of rows (the seed data alone is ~1,200), so unlike the
// small job_title_rules / contact_field_mappings tables this page doesn't render everything
// as editable inputs at once — that would be both slow to render and unpleasant to scroll.
// Instead it shows a bounded page of rows, ordered, with a search box to jump straight to a
// specific entry, and a CSV import for adding many rows at once.
const PAGE_SIZE = 200;

const state = {
  rows: [],
  totalCount: 0,
  searchTerm: ""
};

const el = {
  pageContent: document.getElementById("page-content"),
  loadingState: document.getElementById("loading-state"),
  banner: document.getElementById("tz-banner"),
  tbody: document.getElementById("tz-tbody"),
  newRow: document.getElementById("tz-new-row"),
  rowCountHint: document.getElementById("row-count-hint"),
  importInput: document.getElementById("import-input")
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

function friendlyError(error) {
  if (error?.code === "23505") {
    return "A lookup row for that exact City/State/Country combination already exists.";
  }
  return error?.message || "Something went wrong.";
}

// ---------- rendering ----------

function renderSearchRow() {
  return `
    <div class="field-row" style="margin-bottom: 18px">
      <input
        class="select-input"
        id="tz-search"
        type="search"
        placeholder="Search city, state, country, region or timezone…"
        value="${escapeHtml(state.searchTerm)}"
        style="flex: 1; min-width: 240px"
      />
    </div>
  `;
}

function renderRow(row) {
  return `
    <tr data-id="${row.id}">
      <td><input class="cell-input" data-field="city" value="${escapeHtml(row.city)}" /></td>
      <td><input class="cell-input" data-field="state" value="${escapeHtml(row.state)}" /></td>
      <td><input class="cell-input" data-field="country" value="${escapeHtml(row.country)}" /></td>
      <td><input class="cell-input" data-field="region" value="${escapeHtml(row.region)}" /></td>
      <td><input class="cell-input" data-field="timezone" value="${escapeHtml(row.timezone)}" /></td>
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
      <td><input class="cell-input" data-field="city" placeholder="e.g. Austin" /></td>
      <td><input class="cell-input" data-field="state" placeholder="e.g. Texas" /></td>
      <td><input class="cell-input" data-field="country" placeholder="e.g. United States" /></td>
      <td><input class="cell-input" data-field="region" placeholder="e.g. America East" /></td>
      <td><input class="cell-input" data-field="timezone" placeholder="e.g. (GMT-06:00) Central Time (US and Canada)" /></td>
      <td><button class="btn-primary btn-small" data-action="add">Add row</button></td>
    </tr>
  `;
}

function readRowValues(row) {
  const values = {};
  row.querySelectorAll("[data-field]").forEach((input) => {
    values[input.dataset.field] = input.value.trim();
  });
  return values;
}

// ---------- data ----------

async function loadRows() {
  let query = supabase.from("timezone_lookup").select("*", { count: "exact" });

  const term = state.searchTerm.trim();
  if (term) {
    const escaped = term.replace(/[%_]/g, (c) => `\\${c}`);
    query = query.or(
      `city.ilike.%${escaped}%,state.ilike.%${escaped}%,country.ilike.%${escaped}%,region.ilike.%${escaped}%,timezone.ilike.%${escaped}%`
    );
  }

  query = query.order("country", { ascending: true }).order("state", { ascending: true }).order("city", { ascending: true }).limit(PAGE_SIZE);

  const { data, error, count } = await query;

  if (error) {
    showBanner(friendlyError(error));
    return;
  }

  state.rows = data;
  state.totalCount = count ?? data.length;
  render();
}

function render() {
  const searchHtml = renderSearchRow();
  const tableRows = state.rows.map(renderRow).join("");

  // Search box lives above the table, injected once here since it needs to survive re-renders
  // with the user's current search term preserved.
  const existingSearchWrap = document.getElementById("tz-search-wrap");
  if (existingSearchWrap) existingSearchWrap.remove();
  const wrap = document.createElement("div");
  wrap.id = "tz-search-wrap";
  wrap.innerHTML = searchHtml;
  el.tbody.closest("table").before(wrap);

  el.tbody.innerHTML = tableRows;
  el.newRow.innerHTML = renderNewRow();

  const shown = state.rows.length;
  if (state.totalCount > shown) {
    el.rowCountHint.textContent = state.searchTerm.trim()
      ? `Showing ${shown.toLocaleString()} of ${state.totalCount.toLocaleString()} matching row(s). Refine your search to narrow further.`
      : `Showing the first ${shown.toLocaleString()} of ${state.totalCount.toLocaleString()} row(s). Search above to find a specific entry.`;
  } else {
    el.rowCountHint.textContent = `${shown.toLocaleString()} row(s).`;
  }

  document.getElementById("tz-search").addEventListener("input", onSearchInput);
}

let searchDebounce = null;
function onSearchInput(e) {
  state.searchTerm = e.target.value;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadRows, 300);
}

async function saveRow(id, row) {
  const values = readRowValues(row);
  if (!values.city && !values.state && !values.country) {
    showBanner("At least one of City, State or Country is required.");
    return;
  }

  const { error } = await supabase
    .from("timezone_lookup")
    .update({
      city: values.city,
      state: values.state,
      country: values.country,
      region: values.region,
      timezone: values.timezone
    })
    .eq("id", id);

  if (error) showBanner(friendlyError(error));
  else {
    showBanner("Row saved.", false);
    loadRows();
  }
}

async function deleteRow(id) {
  if (!window.confirm("Delete this lookup row? This can't be undone.")) return;
  const { error } = await supabase.from("timezone_lookup").delete().eq("id", id);
  if (error) showBanner(friendlyError(error));
  else loadRows();
}

async function addRow(row) {
  const values = readRowValues(row);
  if (!values.city && !values.state && !values.country) {
    showBanner("A new row needs at least a City, State or Country.");
    return;
  }

  const { error } = await supabase.from("timezone_lookup").insert(values);

  if (error) showBanner(friendlyError(error));
  else {
    showBanner("Row added.", false);
    loadRows();
  }
}

// ---------- CSV import ----------

const IMPORT_ALIASES = {
  city: ["city", "primary address city", "primary city"],
  state: ["state", "primary state/province", "state/province"],
  country: ["country", "primary address country", "primary country"],
  region: ["region", "region/geography"],
  timezone: ["timezone", "time zone"]
};

function mapImportRow(rawRow, headerIndex) {
  const record = {};
  for (const [field, aliases] of Object.entries(IMPORT_ALIASES)) {
    const header = aliases.map((a) => headerIndex[a]).find(Boolean);
    record[field] = header ? String(rawRow[header] ?? "").trim() : "";
  }
  return record;
}

el.importInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  window.Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async (results) => {
      e.target.value = "";

      const rawHeaders = results.meta.fields || [];
      const headerIndex = {};
      rawHeaders.forEach((h) => {
        headerIndex[h.trim().toLowerCase()] = h;
      });

      const records = results.data
        .map((row) => mapImportRow(row, headerIndex))
        .filter((r) => r.city || r.state || r.country);

      if (!records.length) {
        showBanner("No usable rows found in that file — expected a City, State or Country column.");
        return;
      }

      showBanner(`Importing ${records.length.toLocaleString()} row(s)…`, false);

      // Batched, and ignoreDuplicates so an existing City/State/Country combo is left alone
      // rather than throwing the whole import out on the first collision.
      const BATCH_SIZE = 500;
      let inserted = 0;
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase
          .from("timezone_lookup")
          .upsert(batch, { onConflict: "city,state,country", ignoreDuplicates: true })
          .select("id");

        if (error) {
          showBanner(`Import stopped partway through: ${friendlyError(error)}`);
          return;
        }
        inserted += data?.length ?? 0;
      }

      showBanner(
        `Imported ${inserted.toLocaleString()} new row(s). ${(records.length - inserted).toLocaleString()} were already in the table and left unchanged.`,
        false
      );
      loadRows();
    },
    error: (err) => showBanner(`Couldn't read that file: ${err.message}`)
  });
});

// ---------- event delegation ----------

document.body.addEventListener("click", (e) => {
  const button = e.target.closest("[data-action]");
  if (!button) return;

  const row = button.closest("tr");
  const action = button.dataset.action;

  if (action === "save") saveRow(row.dataset.id, row);
  else if (action === "delete") deleteRow(row.dataset.id);
  else if (action === "add") addRow(row);
});

// ---------- boot ----------

requireSession().then(() => {
  el.loadingState.style.display = "none";
  el.pageContent.style.display = "";
  loadRows();
});

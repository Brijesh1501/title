# Roster Ops — Job Title & Phone Toolkit (Vanilla JS)

Plain HTML/CSS/JavaScript version of the toolkit — no React, no build step, no bundler.
Runs as static files; the only external code loaded is the Supabase JS SDK (via ES module
CDN import) and PapaParse (via a `<script>` tag), both loaded straight in the browser.

Three tools, plus an admin panel:

1. **Job Title Categorizer** (`job-title-categorizer.html`) — matches each title against a
   keyword taxonomy stored in Supabase and returns Responsibility Area, Title Level, and
   Department Function.
2. **Phone Number Formatter** (`phone-formatter.html`) — rewrites US phone numbers into
   `+1 XXX-XXX-XXXX`. Runs entirely client-side, no backend needed.
3. **Report → Contact Sync** (`report-sync.html`) — upload a report export and it's rewritten
   into a contact sheet using a field mapping stored in Supabase. This is a port of the
   original `syncReportToContactSheet()` Apps Script; the hardcoded mapping object from that
   script is now the `contact_field_mappings` table, editable from the admin panel instead of
   in code.
4. **Admin Panel** (behind Supabase Auth):
   - `admin-rules.html` — add, edit, reorder, deactivate or delete the keyword rules that
     drive the categorizer.
   - `admin-mappings.html` — add, edit, reorder, deactivate or delete the report → contact
     field mappings that drive the sync tool.
   No code changes or redeploys required for either one.

## 1. Create the Supabase project

1. Create a new project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the contents of `supabase/schema.sql`, and run it.
   This creates the `job_title_rules` table and the `contact_field_mappings` table, their
   row-level security policies, and seeds both with the same rules/mapping the original Apps
   Scripts used.
3. Open **Authentication → Users → Add user** and create one admin account (email + password).
   There is no public sign-up screen in the app on purpose — admins are provisioned by you.
4. Open **Project Settings → API** and copy the **Project URL** and **anon public** key.

## 2. Configure the app

```bash
cp js/config.example.js js/config.js
# then edit js/config.js and paste in your Project URL / anon key
```

`js/config.js` is gitignored so real keys never get committed to source control.

## 3. Run locally

Because the pages use native ES modules (`<script type="module">` and `import`), you need to
serve them over HTTP — opening the HTML files directly via `file://` will not work in most
browsers. Any static file server works, for example:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then visit the printed local URL. All three tools work immediately; sign in at
`admin-login.html` with the admin account you created to manage rules at `admin-rules.html`
or the report → contact field mapping at `admin-mappings.html`.

## 4. Deploy

This is plain static files — deploy to any static host as-is, no build step:

- **Netlify / Vercel / GitHub Pages / Cloudflare Pages**: point the host at the project
  root. There's no build command to configure.
- Just make sure `js/config.js` (with your real Supabase URL/key) is present in what you
  deploy — it's gitignored, so if you deploy from git you'll need to add it as a build step
  or commit a deploy-specific copy.

## How the rules work

Rules live in the `job_title_rules` table in Supabase:

| column | meaning |
|---|---|
| `rule_type` | `title_level` or `responsibility_area` |
| `priority` | lower = checked first; first keyword match wins |
| `label` | the value returned (e.g. `"CXO"`, `"Data Engineering"`) |
| `dept_function` | only used by `responsibility_area` rules |
| `keywords` | array of words/phrases, matched case-insensitively as whole words |
| `is_active` | untick to retire a rule without deleting it |

Titles that don't match anything fall back to `Staff/IC` / `Others` / `Operations and Others`,
same as the original script's defaults.

Two highlight rules stay hardcoded in the app (matching the original script exactly, since
they're about visual QA rather than taxonomy): any title containing the word "architecture" is
flagged yellow, and anything that falls through to "Others" is flagged pink.

## How the report → contact sync works

Field mappings live in the `contact_field_mappings` table in Supabase:

| column | meaning |
|---|---|
| `report_header` | exact column header expected in the uploaded report CSV (case-sensitive, whitespace-trimmed) |
| `contact_header` | destination column header written to the generated contact sheet |
| `sort_order` | lower = earlier column in the generated contact sheet; also the row order in the admin table |
| `is_active` | untick to retire a mapping without deleting it — the column drops out of new syncs |

When a report CSV is uploaded on `report-sync.html`:

1. Every active mapping is fetched, ordered by `sort_order`; the distinct `contact_header`
   values (first-seen order) become the output column order.
2. A row is skipped entirely if every cell in it is blank — same as the original script's
   `row.every(cell => cell === "")` check.
3. For each remaining row, every output column starts blank and is filled in only where a
   mapping's `report_header` matches a column that's actually present in the uploaded file.
4. Any mapped `report_header` missing from the file is reported once in a banner (not
   per-row), and any column in the file with no mapping at all is listed as unmapped so you
   know what to add.

The result can be downloaded as CSV or as a formatted `.xlsx` workbook, and always contains
every synced row — the on-page preview caps at 500 rows for rendering performance, but the
downloads never do.

## Row Level Security

- **Read** (`select`) is open to everyone, including the anon key used in the browser —
  the categorizer needs to read rules, and the sync tool needs to read field mappings,
  without anyone signing in.
- **Write** (`insert`/`update`/`delete`) requires an authenticated Supabase session — this is
  what actually protects both admin pages, not the secrecy of the anon key (which is meant to
  be public). Same policy shape on both `job_title_rules` and `contact_field_mappings`.

## Project structure

```
index.html                     landing page
job-title-categorizer.html     categorizer UI
phone-formatter.html           formatter UI
report-sync.html                report → contact sync UI
admin-login.html                Supabase email/password sign-in
admin-rules.html                CRUD table for job_title_rules
admin-mappings.html             CRUD table for contact_field_mappings

css/styles.css                  all styles

js/config.example.js            copy to config.js and fill in your Supabase credentials
js/supabaseClient.js            creates the Supabase client (CDN ESM import)
js/lib/phoneUtils.js            phone regex/formatting, ported 1:1 from the Apps Script
js/lib/titleTaxonomy.js         fetches rules from Supabase and applies them to titles
js/lib/reportSync.js            fetches field mappings and applies them to a report CSV,
                                 ported 1:1 from syncReportToContactSheet()
js/lib/csv.js                   CSV parse/export helpers (wraps the PapaParse CDN script)
js/components/sidebar.js        shared nav, reflects live auth state
js/components/auth-guard.js     redirects to login when there's no session
js/pages/*.js                   per-page logic (one file per HTML page)

supabase/schema.sql             tables, indexes, RLS policies, seed data
```

## Notes on this approach

- No `npm install` or bundler is required to run this. The Supabase SDK is imported directly
  from `esm.sh` as an ES module; PapaParse is loaded from `jsdelivr` as a classic script.
  If you'd rather vendor these locally (e.g. for an offline/intranet deployment), download
  both libraries into a `vendor/` folder and update the `import`/`<script src>` paths.
- Routing is just separate HTML files — there's no client-side router. This keeps things
  simple and means every page works with plain "view source" debugging.

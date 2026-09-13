# Roster Ops — Job Title & Phone Toolkit (Vanilla JS)

Plain HTML/CSS/JavaScript version of the toolkit — no React, no build step, no bundler.
Runs as static files; the only external code loaded is the Supabase JS SDK (via ES module
CDN import) and PapaParse (via a `<script>` tag), both loaded straight in the browser.

Two tools, plus an admin panel:

1. **Job Title Categorizer** (`job-title-categorizer.html`) — matches each title against a
   keyword taxonomy stored in Supabase and returns Responsibility Area, Title Level, and
   Department Function.
2. **Phone Number Formatter** (`phone-formatter.html`) — rewrites US phone numbers into
   `+1 XXX-XXX-XXXX`. Runs entirely client-side, no backend needed.
3. **Admin Panel** (`admin-rules.html`, behind Supabase Auth) — add, edit, reorder,
   deactivate or delete the keyword rules that drive the categorizer, no code changes or
   redeploys required.

## 1. Create the Supabase project

1. Create a new project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the contents of `supabase/schema.sql`, and run it.
   This creates the `job_title_rules` table, row-level security policies, and seeds it with
   the same rules the original Apps Script used.
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

Then visit the printed local URL. The two tools work immediately; sign in at
`admin-login.html` with the admin account you created to manage rules at `admin-rules.html`.

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

## Row Level Security

- **Read** (`select`) is open to everyone, including the anon key used in the browser —
  the categorizer needs to read rules without anyone signing in.
- **Write** (`insert`/`update`/`delete`) requires an authenticated Supabase session — this is
  what actually protects the admin panel, not the secrecy of the anon key (which is meant to
  be public).

## Project structure

```
index.html                     landing page
job-title-categorizer.html     categorizer UI
phone-formatter.html           formatter UI
admin-login.html                Supabase email/password sign-in
admin-rules.html                CRUD table for job_title_rules

css/styles.css                  all styles

js/config.example.js            copy to config.js and fill in your Supabase credentials
js/supabaseClient.js            creates the Supabase client (CDN ESM import)
js/lib/phoneUtils.js            phone regex/formatting, ported 1:1 from the Apps Script
js/lib/titleTaxonomy.js         fetches rules from Supabase and applies them to titles
js/lib/csv.js                   CSV parse/export helpers (wraps the PapaParse CDN script)
js/components/sidebar.js        shared nav, reflects live auth state
js/components/auth-guard.js     redirects to login when there's no session
js/pages/*.js                   per-page logic (one file per HTML page)

supabase/schema.sql             table, indexes, RLS policies, seed data
```

## Notes on this approach

- No `npm install` or bundler is required to run this. The Supabase SDK is imported directly
  from `esm.sh` as an ES module; PapaParse is loaded from `jsdelivr` as a classic script.
  If you'd rather vendor these locally (e.g. for an offline/intranet deployment), download
  both libraries into a `vendor/` folder and update the `import`/`<script src>` paths.
- Routing is just separate HTML files — there's no client-side router. This keeps things
  simple and means every page works with plain "view source" debugging.

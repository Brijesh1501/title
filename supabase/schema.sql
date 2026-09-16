-- Job Title Taxonomy schema
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).

create extension if not exists "pgcrypto";

create table if not exists job_title_rules (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null check (rule_type in ('title_level', 'responsibility_area')),
  priority integer not null default 100,
  label text not null,
  dept_function text,               -- only meaningful for responsibility_area rows
  keywords text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_title_rules_lookup_idx
  on job_title_rules (rule_type, priority);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_job_title_rules_updated on job_title_rules;
create trigger trg_job_title_rules_updated
before update on job_title_rules
for each row execute function set_updated_at();

-- Row Level Security -------------------------------------------------------
-- The categorizer tool needs to read rules with the public anon key, so
-- SELECT is open. Writes require a signed-in (authenticated) admin user.

alter table job_title_rules enable row level security;

drop policy if exists "Public can read rules" on job_title_rules;
create policy "Public can read rules"
  on job_title_rules for select
  using (true);

drop policy if exists "Authenticated users manage rules" on job_title_rules;
create policy "Authenticated users manage rules"
  on job_title_rules for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Seed data ------------------------------------------------------------
-- Mirrors the priority order of the if/else chain in the original
-- mapTitleToTaxonomy() Apps Script function. Lower priority = checked first.
-- Titles that match nothing default to: Title Level "Staff/IC",
-- Responsibility Area "Others", Department Function "Operations and Others"
-- (handled in application code, not stored as rows here).

insert into job_title_rules (rule_type, priority, label, dept_function, keywords) values
-- Title Level rules
('title_level', 10, 'CXO', null, array['ceo','cfo','cto','coo','cpo','cco','cio','ciso','cdo','caio','ctpo','chief architect','chief software architect','chief','co-founder','co founder','cofounder','founder','board member','managing director','md']),
('title_level', 20, 'Director/AVP', null, array['principal']),
('title_level', 30, 'SVP/VP/Head', null, array['president','vp','vice president','head','svp','evp','avp']),
('title_level', 40, 'Director/AVP', null, array['director']),
('title_level', 50, 'Manager', null, array['architect','architecture']),
('title_level', 60, 'Manager', null, array['manager','gm','general manager']),
('title_level', 70, 'Lead', null, array['lead','team lead','tech lead','technical lead']),

-- Responsibility Area rules
('responsibility_area', 10, 'FinOps', 'IT & Engineering', array['finops']),
('responsibility_area', 20, 'DevOps / SRE', 'IT & Engineering', array['devops','sre','site reliability','devsecops','release engineer','release management','ci/cd','build and release','infrastructure automation','platform reliability','systems reliability','chaos engineer','gitops','infra','infrastructure','it infrastructure','aws','azure','gcp','amazon web services','google cloud platform','it operations']),
('responsibility_area', 30, 'Overall Cloud Infra', 'IT & Engineering', array['cloud','serverless','iac','platform engineer','cloud security','cloud operations']),
('responsibility_area', 40, 'Data Engineering', 'IT & Engineering', array['data','ai','ai/ml','artificial intelligence','machine learning','data science','data engineering','data engineer','business intelligence','bi','analytics','analyst','analysts']),
('responsibility_area', 50, 'Overall Engineering / SW Dev', 'IT & Engineering', array['ctpo','technology and product','product and technology','cto','cio','ciso','chief information officer','information officer','information security','technology','tech','technical','engineering','software','sw dev','dev','developer','developers','it','architect','architecture','chief software architect','principal engineer','engineer','application development','applications','application','research and development','r&d','research & development','web development','website development','fullstack development','fullstack','full stack']),
('responsibility_area', 60, 'Product Dev', 'IT & Engineering', array['product','cpo','chief product officer']),
('responsibility_area', 70, 'Finance / Cloud Budget', 'Finance', array['finance','cfo','financial','controller','budget','financial planning and analysis','fp and a','fp&a']),
('responsibility_area', 80, 'Overall Operations', 'Operations and Others', array['operations','coo','operating officer']),
('responsibility_area', 90, 'Overall Business', 'Management', array['ceo','chief executive','co-founder','co founder','cofounder','founder','president','owner','board member','managing director','md']);

-- ===========================================================================
-- Report -> Contact Sheet field mappings
-- ===========================================================================
-- Ported from the original syncReportToContactSheet() Apps Script. The Apps
-- Script hardcoded a JS object mapping "Report" column headers to "Contact"
-- sheet column headers; here that mapping lives in a table so an admin can
-- add, rename, reorder, deactivate or delete a field mapping from the admin
-- panel, with no code changes or redeploys required.
--
--   report_header   the exact column header expected in the uploaded report
--                    export (case-sensitive, matches the source system's export)
--   contact_header   the destination column header written to the generated
--                    contact sheet
--   sort_order       lower = earlier column in the generated contact sheet;
--                    also the order shown/edited in the admin panel
--   is_active        untick to retire a mapping without deleting it — the
--                    column disappears from new syncs but the row (and any
--                    history you keep elsewhere) is preserved

create table if not exists contact_field_mappings (
  id uuid primary key default gen_random_uuid(),
  report_header text not null,
  contact_header text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_field_mappings_report_header_key unique (report_header)
);

create index if not exists contact_field_mappings_sort_idx
  on contact_field_mappings (sort_order);

drop trigger if exists trg_contact_field_mappings_updated on contact_field_mappings;
create trigger trg_contact_field_mappings_updated
before update on contact_field_mappings
for each row execute function set_updated_at();

-- Row Level Security -------------------------------------------------------
-- Same policy shape as job_title_rules: the sync tool needs to read active
-- mappings with the public anon key, writes require a signed-in admin.

alter table contact_field_mappings enable row level security;

drop policy if exists "Public can read field mappings" on contact_field_mappings;
create policy "Public can read field mappings"
  on contact_field_mappings for select
  using (true);

drop policy if exists "Authenticated users manage field mappings" on contact_field_mappings;
create policy "Authenticated users manage field mappings"
  on contact_field_mappings for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Seed data ------------------------------------------------------------
-- Exactly the mapping object from the original syncReportToContactSheet()
-- Apps Script, in the same order (used here as the default column order of
-- the generated contact sheet).

insert into contact_field_mappings (report_header, contact_header, sort_order) values
('Contact: Contact ID', 'Contact ID', 10),
('Account: Account Name', 'Account Name', 20),
('Account: Website', 'Website', 30),
('Contact: First Name', 'First Name', 40),
('Contact: Last Name', 'Last Name', 50),
('Contact: Title', 'Title', 60),
('Contact: Responsibility Area', 'Responsibility Area', 70),
('Contact: Title Level', 'Title Level', 80),
('Contact: Department Function', 'Department Function', 90),
('Contact: Email Address', 'Email Address', 100),
('Contact: Mobile No.', 'Mobile No.', 110),
('Contact: Direct No.', 'Direct No.', 120),
('Contact: Primary City', 'Primary City', 130),
('Contact: Primary State/Province', 'Primary State/Province', 140),
('Contact: Primary Country', 'Primary Country', 150),
('Contact: Region/Geography', 'Region/Geography', 160),
('Contact: Timezone', 'Timezone', 170),
('Contact: Contact LinkedIn', 'Contact LinkedIn', 180),
('Contact: DRA Name', 'Dra name', 190),
('Campaign Name', 'Campaign Name', 200),
('Contact: Email Bounced', 'Email Bounced', 210),
('Created Date', 'Created Date', 220)
on conflict (report_header) do nothing;

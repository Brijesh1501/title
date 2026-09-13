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

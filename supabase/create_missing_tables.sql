-- =====================================================================
-- NEXUS OS — Missing Supabase tables
-- Run in: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Verified against live schema on 2026-07-25.
-- Existing tables: leads, inventory, competitors, rag_documents
-- This script creates the 5 tables the n8n workflows reference but
-- which do not exist yet. Safe to re-run (all statements idempotent).
-- =====================================================================

create extension if not exists vector;

-- 1. Audit log — Master Router, Lead Escalation, KYC Auditor, Pricing
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  workflow    text,
  status      text,
  lead_name   text,
  lead_email  text,
  lead_score  numeric,
  intent      text,
  summary     text,
  logged_at   timestamptz default now()
);

-- 2. Omnichannel comms history — WhatsApp BDC, Drip, Escalation timeline
create table if not exists public.communication_logs (
  id          uuid primary key default gen_random_uuid(),
  lead_email  text,
  channel     text,   -- 'whatsapp' | 'email' | 'sms' | 'slack'
  direction   text,   -- 'inbound' | 'outbound'
  message     text,
  created_at  timestamptz default now()
);

-- 3. Sales reps / staff directory — Lead Escalation "find_available_rep"
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  email         text unique,
  role          text,   -- 'senior_rep' | 'rep' | 'manager'
  status        text,   -- 'online' | 'offline' | 'away'
  slack_user_id text,
  created_at    timestamptz default now()
);

-- 4. Closed-won deal embeddings — pgvector sync workflow
create table if not exists public.deals_embeddings (
  id          uuid primary key default gen_random_uuid(),
  deal_id     text unique,
  content     text,
  embedding   vector(1536),
  created_at  timestamptz default now()
);

-- 5. Unified customer profiles — Customer 360 aggregation
create table if not exists public.customer_360_profiles (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          text unique,
  name                 text,
  email                text,
  phone                text,
  total_emails         integer default 0,
  total_slack_messages integer default 0,
  last_synced_at       timestamptz default now()
);

-- ---------------------------------------------------------------------
-- Unique key on leads.email.
-- REQUIRED: PostgREST upsert with on_conflict=email fails without this.
-- ---------------------------------------------------------------------
create unique index if not exists leads_email_key
  on public.leads (email) where email is not null;

-- Lookup indexes for the queries n8n actually runs
create index if not exists idx_audit_log_lead_email  on public.audit_log (lead_email);
create index if not exists idx_audit_log_logged_at   on public.audit_log (logged_at desc);
create index if not exists idx_comm_logs_lead_email  on public.communication_logs (lead_email);
create index if not exists idx_comm_logs_created_at  on public.communication_logs (created_at desc);
create index if not exists idx_users_role_status     on public.users (role, status);
create index if not exists idx_c360_email            on public.customer_360_profiles (email);

-- Vector similarity index for RAG (build after you have rows; safe now)
create index if not exists idx_deals_embeddings_vec
  on public.deals_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ---------------------------------------------------------------------
-- RLS — matches the pattern already used by leads / inventory.
-- n8n connects with the service_role key, which bypasses RLS, so these
-- policies exist to keep anon/authenticated clients locked out.
-- ---------------------------------------------------------------------
alter table public.audit_log             enable row level security;
alter table public.communication_logs    enable row level security;
alter table public.users                 enable row level security;
alter table public.deals_embeddings      enable row level security;
alter table public.customer_360_profiles enable row level security;

-- ---------------------------------------------------------------------
-- Seed at least one senior rep, otherwise Lead Escalation's
-- "find_available_rep" tool has nobody to route an escalated lead to.
-- Edit the values below before running if you want a different rep.
-- ---------------------------------------------------------------------
insert into public.users (name, email, role, status, slack_user_id)
values ('Ali Asgher', 'aliasgher892@gmail.com', 'senior_rep', 'online', null)
on conflict (email) do nothing;

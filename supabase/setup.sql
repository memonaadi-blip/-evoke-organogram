-- =====================================================================
-- Evoke Organogram — Supabase setup
-- Run this once in your project's SQL editor (Supabase dashboard → SQL).
-- The whole organisation lives in ONE row (id = 1): a JSON array of
-- employees plus the drill config. Viewers read it; only signed-in admins
-- can write it (enforced server-side by Row Level Security).
-- =====================================================================

-- 1) table -------------------------------------------------------------
create table if not exists public.organogram (
  id          int primary key,
  employees   jsonb not null default '[]'::jsonb,
  config      jsonb,
  updated_at  timestamptz not null default now()
);

-- 2) Row Level Security ------------------------------------------------
alter table public.organogram enable row level security;

-- anyone (even logged-out viewers) may READ
drop policy if exists "public read" on public.organogram;
create policy "public read"
  on public.organogram for select
  using (true);

-- only authenticated users may INSERT / UPDATE (i.e. publish)
drop policy if exists "authenticated write" on public.organogram;
create policy "authenticated write"
  on public.organogram for all
  to authenticated
  using (true) with check (true);

-- 3) realtime: broadcast row changes to subscribed viewers -------------
alter publication supabase_realtime add table public.organogram;

-- =====================================================================
-- AFTER running this:
--   • Authentication → Providers → Email: keep it on, and turn OFF
--     "Allow new users to sign up" so only YOUR admin can write.
--   • Authentication → Users → "Add user": create your admin
--     (email + password) — that's the login the site will use.
--   • Settings → API: copy the Project URL + anon public key into
--     js/supabase-config.js.
--   • Seeding row 1: open the site with ?edit=1, "Sign in to edit",
--     then click "Publish to cloud" — that writes the current data into
--     row 1. (No need to paste the data here.)
-- =====================================================================

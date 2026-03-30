-- AFYA Medication Persistence Migration
-- Run in Supabase SQL Editor

-- ── medications: user's medication list ───────────────────────────────────
create table if not exists public.medications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  time       text not null default '08:00',
  condition  text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.medications enable row level security;

create policy "Users manage own medications"
  on public.medications for all
  using (auth.uid() = user_id);

create index if not exists medications_user
  on public.medications (user_id, active);

-- ── med_logs: daily taken/missed records ──────────────────────────────────
create table if not exists public.med_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  medication_id uuid not null references public.medications(id) on delete cascade,
  taken         boolean not null,
  logged_date   date not null default current_date,
  logged_at     timestamptz not null default now(),
  unique (medication_id, logged_date)
);

alter table public.med_logs enable row level security;

create policy "Users manage own med logs"
  on public.med_logs for all
  using (auth.uid() = user_id);

create index if not exists med_logs_user_date
  on public.med_logs (user_id, logged_date desc);

create index if not exists med_logs_med_date
  on public.med_logs (medication_id, logged_date desc);

-- AFYA Step 5: Health Logs table for AI engine
-- Run this in Supabase Dashboard → SQL Editor

create table if not exists public.health_logs (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  type        text        not null,   -- 'blood_sugar' | 'bp' | 'weight' | 'symptom'
  value       numeric,                -- primary value (blood sugar mg/dL, systolic BP, weight kg)
  value2      numeric,                -- secondary value (diastolic BP)
  unit        text,                   -- 'mg/dL' | 'mmHg' | 'kg'
  context     text,                   -- 'fasting' | 'after_meal' | 'bedtime' | 'morning'
  notes       text,
  logged_at   timestamptz not null default now()
);

alter table public.health_logs enable row level security;

create policy "Users can manage own health logs"
  on public.health_logs for all
  using (auth.uid() = user_id);

-- Index for fast per-user queries
create index if not exists health_logs_user_logged
  on public.health_logs (user_id, logged_at desc);

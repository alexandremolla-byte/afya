-- AFYA Analytics Events Table
-- Run this in your Supabase SQL Editor

create table if not exists public.analytics_events (
  id          uuid primary key default gen_random_uuid(),
  event_name  text not null,
  user_id     uuid references public.profiles(id) on delete set null,
  session_id  text,
  properties  jsonb default '{}',
  created_at  timestamptz not null default now()
);

alter table public.analytics_events enable row level security;

-- Anyone (including anon) can insert events (fire-and-forget tracking)
create policy "Anyone can insert analytics events"
  on public.analytics_events for insert
  with check (true);

-- Only service role can read (admin dashboard uses service key)
create policy "No direct reads"
  on public.analytics_events for select
  using (false);

-- Index for dashboard queries
create index if not exists analytics_events_name_created
  on public.analytics_events (event_name, created_at desc);

create index if not exists analytics_events_created
  on public.analytics_events (created_at desc);

create index if not exists analytics_events_user
  on public.analytics_events (user_id, created_at desc);

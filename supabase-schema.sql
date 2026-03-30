-- ─────────────────────────────────────────────────────────────────────────────
-- AFYA — Supabase Schema
-- Run this entire file in your Supabase project's SQL Editor
-- (supabase.com → your project → SQL Editor → New query → paste → Run)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create the profiles table
create table if not exists public.profiles (
  id                 uuid        primary key references auth.users(id) on delete cascade,
  name               text        not null,
  age                text,
  condition          text,                   -- 'diabetes' | 'hypertension' | 'maternal' | 'general'
  weeks              text,                   -- only for maternal: weeks of pregnancy
  applied_promo      text,                   -- promo code used at signup (if any)
  referral_code      text        unique,     -- this user's own shareable code
  friends_referred   integer     default 0,
  free_months_earned integer     default 0,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- 2. Enable Row Level Security (RLS) — users can only read/write their own row
alter table public.profiles enable row level security;

-- Allow users to read their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Allow users to insert their own profile
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Allow users to update their own profile
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- 3. Auto-update the updated_at timestamp on any row change
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger on_profiles_updated
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

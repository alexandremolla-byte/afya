-- ─────────────────────────────────────────────────────────────────────────────
-- AFYA — Premium Subscription Migration
-- Run in Supabase SQL Editor after the initial schema
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists is_premium          boolean     default false,
  add column if not exists premium_since       timestamptz,
  add column if not exists premium_expires_at  timestamptz;

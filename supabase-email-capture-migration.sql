create table if not exists email_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text default 'landing_page',
  created_at timestamptz default now(),
  drip_step integer default 0,
  last_emailed_at timestamptz,
  unsubscribed boolean default false
);

alter table email_leads enable row level security;

create policy "Anyone can submit email" on email_leads for insert with check (true);

create policy "Service role full access" on email_leads using (auth.role() = 'service_role');

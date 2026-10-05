-- Iron Log database setup
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

-- 1) Who is allowed in. Add one row per friend (their login email, lowercase).
create table if not exists public.crew_emails (
  email text primary key
);

-- 2) Display names
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nick text not null check (char_length(nick) between 1 and 24),
  joined_at timestamptz not null default now()
);

-- 3) Workouts (one row per session; exercises + sets stored as JSON)
create table if not exists public.sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Workout',
  date date not null default current_date,
  started_at bigint not null,
  finished boolean not null default false,
  exercises jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists sessions_user_started on public.sessions (user_id, started_at desc);

-- Helper: is the signed-in user on the crew list?
create or replace function public.is_crew() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.crew_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Row-level security: crew members read everything, but only write their own rows.
alter table public.crew_emails enable row level security;
alter table public.profiles    enable row level security;
alter table public.sessions    enable row level security;

drop policy if exists "see own crew entry" on public.crew_emails;
create policy "see own crew entry" on public.crew_emails
  for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "crew reads profiles" on public.profiles;
create policy "crew reads profiles" on public.profiles
  for select to authenticated using (public.is_crew());
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles
  for insert to authenticated with check (public.is_crew() and id = auth.uid());
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "crew reads sessions" on public.sessions;
create policy "crew reads sessions" on public.sessions
  for select to authenticated using (public.is_crew());
drop policy if exists "own session insert" on public.sessions;
create policy "own session insert" on public.sessions
  for insert to authenticated with check (public.is_crew() and user_id = auth.uid());
drop policy if exists "own session update" on public.sessions;
create policy "own session update" on public.sessions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own session delete" on public.sessions;
create policy "own session delete" on public.sessions
  for delete to authenticated using (user_id = auth.uid());

-- Live updates when a friend logs a workout
do $$ begin
  alter publication supabase_realtime add table public.sessions, public.profiles;
exception when others then null; end $$;

-- 4) Add your crew (edit these, then run). Lowercase emails.
-- insert into public.crew_emails (email) values
--   ('you@example.com'),
--   ('friend1@example.com'),
--   ('friend2@example.com')
-- on conflict do nothing;

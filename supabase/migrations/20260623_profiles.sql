-- Profiles + per-unit high scores/mastery for the physics demo.
--
-- The demo app authenticates with a hard-coded `test` user and talks to Supabase
-- with the anon (publishable) key — there is no Supabase Auth session — so the
-- policies below intentionally allow the anon role to read/insert/update rows.
-- Tighten these (tie `id` to auth.users and scope policies to auth.uid()) once
-- real authentication is wired up.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).

create table if not exists public.profiles (
  id                   uuid primary key default gen_random_uuid(),
  username             text unique not null,
  display_name         text,
  kinematics_high_score integer not null default 0,
  kinematics_mastered   boolean not null default false,
  motion_graphs_mastered boolean not null default false,
  forces_mastered       boolean not null default false,
  energy_mastered       boolean not null default false,
  circuits_mastered     boolean not null default false,
  momentum_mastered     boolean not null default false,
  updated_at           timestamptz not null default now()
);

-- Keep the profile row ready for the full course map. When the remaining
-- catalog is added, follow the same `<unit_slug>_mastered boolean not null default false`
-- pattern for each unit.
alter table public.profiles
  add column if not exists kinematics_mastered boolean not null default false,
  add column if not exists motion_graphs_mastered boolean not null default false,
  add column if not exists forces_mastered boolean not null default false,
  add column if not exists energy_mastered boolean not null default false,
  add column if not exists circuits_mastered boolean not null default false,
  add column if not exists momentum_mastered boolean not null default false;

alter table public.profiles enable row level security;

drop policy if exists "demo anon select profiles" on public.profiles;
create policy "demo anon select profiles"
  on public.profiles for select
  to anon, authenticated
  using (true);

drop policy if exists "demo anon insert profiles" on public.profiles;
create policy "demo anon insert profiles"
  on public.profiles for insert
  to anon, authenticated
  with check (true);

drop policy if exists "demo anon update profiles" on public.profiles;
create policy "demo anon update profiles"
  on public.profiles for update
  to anon, authenticated
  using (true)
  with check (true);

-- Seed the demo learner used by the test login.
insert into public.profiles (
  username,
  display_name,
  kinematics_high_score,
  kinematics_mastered,
  motion_graphs_mastered,
  forces_mastered,
  energy_mastered,
  circuits_mastered,
  momentum_mastered
)
values ('test', 'Demo Learner', 0, false, false, false, false, false, false)
on conflict (username) do nothing;

-- ONE-TIME cleanup + reset (SELF-CONTAINED + IDEMPOTENT).
--
-- Safe to run on its own even if the earlier additive migrations were never
-- applied: it first ensures every column the app needs exists on `profiles`,
-- then it:
--   1. Deletes the leftover DEMO data ("test" learner) entirely.
--   2. Resets EVERY remaining real account to the starter state:
--        coins = 0, skill_points = 0, overall = 50, no equipped cosmetics,
--        all five sim high scores = 0, all mastery flags = false, and all
--        structured state (skills/inventory/proficiency/test_history/progress)
--        cleared so the client re-seeds clean defaults on next login.
--   3. Clears the normalized stat tables IF they exist (now superseded by the
--      jsonb columns on profiles).
--
-- Paste into the Supabase SQL editor (Dashboard -> SQL -> New query).

begin;

-- 0. Make sure every column exists (additive — no-op if already present).
alter table public.profiles
  add column if not exists coins                     integer not null default 0,
  add column if not exists skill_points              integer not null default 0,
  add column if not exists overall                   integer not null default 50,
  add column if not exists equipped_jersey           text,
  add column if not exists equipped_cleats           text,
  add column if not exists kinematics_high_score     integer not null default 0,
  add column if not exists motion_graphs_high_score  integer not null default 0,
  add column if not exists forces_high_score         integer not null default 0,
  add column if not exists energy_high_score         integer not null default 0,
  add column if not exists momentum_high_score       integer not null default 0,
  add column if not exists kinematics_mastered       boolean not null default false,
  add column if not exists motion_graphs_mastered    boolean not null default false,
  add column if not exists forces_mastered           boolean not null default false,
  add column if not exists energy_mastered           boolean not null default false,
  add column if not exists circuits_mastered         boolean not null default false,
  add column if not exists momentum_mastered         boolean not null default false,
  add column if not exists impulse_mastered          boolean not null default false,
  add column if not exists skills                    jsonb,
  add column if not exists inventory                 jsonb,
  add column if not exists proficiency               jsonb,
  add column if not exists test_history              jsonb,
  add column if not exists progress                  jsonb;

-- 1. Remove demo data. Deleting the profile cascades any child rows that
--    reference profiles(id) on delete cascade.
delete from public.profiles where lower(username) = 'test';

-- 2. Reset all remaining users to starter defaults.
update public.profiles set
  coins                     = 0,
  skill_points              = 0,
  overall                   = 50,
  equipped_jersey           = null,
  equipped_cleats           = null,
  kinematics_high_score     = 0,
  motion_graphs_high_score  = 0,
  forces_high_score         = 0,
  energy_high_score         = 0,
  momentum_high_score       = 0,
  kinematics_mastered       = false,
  motion_graphs_mastered    = false,
  forces_mastered           = false,
  energy_mastered           = false,
  circuits_mastered         = false,
  momentum_mastered         = false,
  impulse_mastered          = false,
  skills                    = null,
  inventory                 = null,
  proficiency               = null,
  test_history              = null,
  progress                  = null,
  updated_at                = now();

-- 3. Remove the demo account + clear the normalized stat tables, but only the
--    ones that actually exist (so this runs cleanly on any schema state).
do $$
declare
  t text;
begin
  if to_regclass('public.accounts') is not null then
    delete from public.accounts where lower(username) = 'test';
  end if;

  foreach t in array array[
    'player_skills', 'concept_proficiency', 'unit_proficiency',
    'test_attempts', 'match_results', 'inventory'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I;', t);
    end if;
  end loop;
end $$;

commit;

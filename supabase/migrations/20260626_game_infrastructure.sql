-- Game infrastructure: player RPG layer, the pre-game test bank, proficiency
-- tracking, match results, and the cosmetics economy.
--
-- ADDITIVE ONLY. This migration never drops or rewrites existing columns/tables,
-- so the working lessons/mastery/high-score features keep functioning. The demo
-- still authenticates as the hard-coded `test` user via the anon key (no Supabase
-- Auth session), so RLS intentionally allows anon read/insert/update for the demo.
-- Tighten these once real auth exists.
--
-- Run once in the Supabase SQL editor (Dashboard -> SQL -> New query).

-- ---------------------------------------------------------------------------
-- 1. Extend profiles with the economy + player meta (additive columns only).
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists coins            integer not null default 0,
  add column if not exists skill_points     integer not null default 0,
  add column if not exists overall          integer not null default 50,
  add column if not exists equipped_jersey  text,
  add column if not exists equipped_cleats  text,
  add column if not exists impulse_mastered boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Player skills: one row per user per skill (six skills, start at 50).
--    skill_id mirrors the unit ids: kinematics, motion-graphs, forces, energy,
--    momentum, impulse.
-- ---------------------------------------------------------------------------
create table if not exists public.player_skills (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  skill_id   text not null,
  rating     integer not null default 50,
  updated_at timestamptz not null default now(),
  primary key (user_id, skill_id)
);

-- ---------------------------------------------------------------------------
-- 3. Question bank: the AI-authored, offline-seeded set. 6 units x 4 problems
--    x 3 difficulty levels = 72 rows. Answers are stored (and verified against
--    the physics engine at authoring time), so the test runs with zero live AI.
-- ---------------------------------------------------------------------------
create table if not exists public.question_bank (
  id               text primary key,
  unit_id          text not null,
  concept_tag      text not null,
  difficulty       integer not null check (difficulty between 1 and 3),
  prompt           text not null,
  choices          jsonb not null,
  correct_choice   text not null,
  correct_value    numeric,
  given            jsonb,
  explanation      text,
  created_at       timestamptz not null default now()
);
create index if not exists question_bank_unit_diff_idx
  on public.question_bank (unit_id, difficulty);

-- ---------------------------------------------------------------------------
-- 4. Test attempts: every gating test, with per-unit/per-concept metrics that
--    drive personalization of the NEXT test (deterministic selection).
-- ---------------------------------------------------------------------------
create table if not exists public.test_attempts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  score           integer not null,
  total           integer not null,
  passed_70       boolean not null default false,
  passed_90       boolean not null default false,
  points_awarded  integer not null default 0,
  per_unit        jsonb,
  per_concept     jsonb,
  taken_at        timestamptz not null default now()
);
create index if not exists test_attempts_user_idx
  on public.test_attempts (user_id, taken_at desc);

-- ---------------------------------------------------------------------------
-- 5. Concept proficiency: the fine-grained "how good / how stale" signal, one
--    row per user per concept tag. Powers spaced repetition + weak-concept
--    review targeting.
-- ---------------------------------------------------------------------------
create table if not exists public.concept_proficiency (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  concept_tag  text not null,
  unit_id      text not null,
  attempts     integer not null default 0,
  correct      integer not null default 0,
  proficiency  numeric not null default 0,
  avg_time_ms  integer not null default 0,
  miss_streak  integer not null default 0,
  sr_box       integer not null default 0,
  next_due     timestamptz,
  last_seen    timestamptz,
  primary key (user_id, concept_tag)
);

-- ---------------------------------------------------------------------------
-- 6. Unit proficiency: coarse rollup, one row per user per unit. Fast reads for
--    the dashboard, the test's 4-per-unit difficulty selection, and the match.
-- ---------------------------------------------------------------------------
create table if not exists public.unit_proficiency (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  unit_id      text not null,
  proficiency  numeric not null default 0,
  accuracy     numeric not null default 0,
  avg_time_ms  integer not null default 0,
  attempts     integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, unit_id)
);

-- ---------------------------------------------------------------------------
-- 7. Match results: outcome + coins for the career/economy loop.
-- ---------------------------------------------------------------------------
create table if not exists public.match_results (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  won            boolean not null,
  goals_for      integer not null default 0,
  goals_against  integer not null default 0,
  coins_earned   integer not null default 0,
  decisions      jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists match_results_user_idx
  on public.match_results (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 8. Inventory: owned + equipped cosmetics (jerseys / cleats).
-- ---------------------------------------------------------------------------
create table if not exists public.inventory (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  item_id     text not null,
  kind        text not null,
  equipped    boolean not null default false,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- ---------------------------------------------------------------------------
-- RLS: demo-open policies (anon + authenticated) matching the existing profiles
-- table. Tighten to auth.uid() once real authentication is wired up.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'player_skills', 'question_bank', 'test_attempts',
    'concept_proficiency', 'unit_proficiency', 'match_results', 'inventory'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists "demo anon select %1$s" on public.%1$I;', t);
    execute format(
      'create policy "demo anon select %1$s" on public.%1$I for select to anon, authenticated using (true);', t);

    execute format('drop policy if exists "demo anon insert %1$s" on public.%1$I;', t);
    execute format(
      'create policy "demo anon insert %1$s" on public.%1$I for insert to anon, authenticated with check (true);', t);

    execute format('drop policy if exists "demo anon update %1$s" on public.%1$I;', t);
    execute format(
      'create policy "demo anon update %1$s" on public.%1$I for update to anon, authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Seed the demo learner's six skills at 50 (only if the profile row exists).
-- ---------------------------------------------------------------------------
insert into public.player_skills (user_id, skill_id, rating)
select p.id, s.skill_id, 50
from public.profiles p
cross join (
  values ('kinematics'), ('motion-graphs'), ('forces'),
         ('energy'), ('momentum'), ('impulse')
) as s(skill_id)
where p.username = 'test'
on conflict (user_id, skill_id) do nothing;

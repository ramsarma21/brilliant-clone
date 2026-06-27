-- Per-user, per-sim ALL-TIME high scores.
--
-- The app now offers FIVE drills (Kinematics, Motion Graphs, Forces, Energy,
-- Momentum/Defending — the Goalkeeping/impulse sim is retained in code but not
-- offered). `profiles.kinematics_high_score` already existed; this adds the four
-- remaining columns so each user's best single-session result for every offered
-- sim is stored, scoped to their `username`.
--
-- ADDITIVE ONLY — safe to run on top of the existing schema.
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query).

alter table public.profiles
  add column if not exists kinematics_high_score    integer not null default 0,
  add column if not exists motion_graphs_high_score integer not null default 0,
  add column if not exists forces_high_score         integer not null default 0,
  add column if not exists energy_high_score          integer not null default 0,
  add column if not exists momentum_high_score        integer not null default 0;

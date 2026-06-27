-- YOUR club's identity (FC name + crest) on the profiles row.
--
-- Editable in the locker and stored per user, so every account has its own club name and
-- emblem. The league simulation (season-by-season scores for all 26 clubs) is derived from
-- the per-account `league_seed` carried inside the existing `progress` jsonb, so it needs no
-- column of its own. Shape:
--
--   club_identity -> {
--     "name": "Physics FC",
--     "emblem": { "shape": "shield", "motif": "ball",
--                 "primary": "#...", "secondary": "#...", "accent": "#..." }
--   }
--
-- (emblem colours are optional — when absent the crest follows the equipped jersey colours.)
--
-- ADDITIVE ONLY — safe to run on top of the existing schema.
-- Run once in the Supabase SQL editor (Dashboard -> SQL -> New query).

alter table public.profiles
  add column if not exists club_identity jsonb;

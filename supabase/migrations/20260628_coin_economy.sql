-- Coin-farm economy.
--
-- The new loop: coins are EARNED only in the Coin Farm (a perfect-or-nothing
-- adaptive quiz) and SPENT to enter matchdays; a match only refunds the entry
-- (plus a bonus) if its objective is completed.
--
-- Persistence:
--   • coins             — the existing `profiles.coins` column (unchanged).
--   • skill points      — the existing `profiles.skill_points` column (unchanged).
--   • perfect streak,    \
--     first-match-free,   }  all live inside the existing `profiles.progress` jsonb
--     first-farm-done,    /   (perfectStreak / firstMatchUsed / firstFarmDone) and
--     per-matchday        /    the per-matchday challenge id + completion flag inside
--     challenge result   /     progress.matchResults[md].{challengeId,challengeDone}.
--
-- Because all of the new state rides in columns/jsonb that already round-trip to
-- the cloud, NO new columns are required. This migration only:
--   1. Makes sure `coins` has a sane default.
--   2. Grants a one-time STARTER balance to any existing account that can't even
--      afford a matchday under the new entry cost, so returning testers can play.
--
-- ADDITIVE / low-risk. Run once in the Supabase SQL editor.

alter table public.profiles
  alter column coins set default 0;

-- Top up accounts that are below the matchday entry cost to the starter grant (90),
-- so the new economy is playable for everyone. Leaves richer accounts untouched.
update public.profiles
set coins = 90
where coalesce(coins, 0) < 25;

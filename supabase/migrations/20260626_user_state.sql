-- Full per-user game state on the profiles row.
--
-- Everything measurable in the app is now personalized and stored against the
-- signed-in user's `username` (the only key the client knows — there is no
-- Supabase Auth session). Coins / skill_points / overall / equipped_* / the five
-- *_high_score columns / the *_mastered flags already live on `profiles`; this
-- adds the remaining structured state as jsonb so NOTHING is hard-coded:
--
--   skills        -> { shooting:50, passing:50, dribbling:50, heading:50, defending:50, stamina:50 }
--                    (see 20260628_game_skills.sql — legacy unit-keyed values are remapped)
--   inventory     -> ["starter-jersey","starter-cleats", ...owned cosmetic ids]
--   proficiency   -> ProficiencyMap (per-concept competence + spaced-repetition)
--   test_history  -> TestAttempt[] (gating-test results that personalize the next test)
--   progress      -> UserProgress (lesson/unit state, mastery, streak)
--
-- ADDITIVE ONLY — safe to run on top of the existing schema.
-- Run once in the Supabase SQL editor (Dashboard -> SQL -> New query).

alter table public.profiles
  add column if not exists skills       jsonb,
  add column if not exists inventory    jsonb,
  add column if not exists proficiency  jsonb,
  add column if not exists test_history jsonb,
  add column if not exists progress     jsonb;

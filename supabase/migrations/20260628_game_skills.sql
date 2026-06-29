-- Decouple the player's 3D-match attributes from the physics learning units.
--
-- The `profiles.skills` jsonb used to be keyed by the LEARNING UNIT ids
-- (kinematics / motion-graphs / forces / energy / momentum). Your 3D FIFA-style
-- player now has its own six upgradable GAME SKILLS that are stored directly:
--
--   skills -> { shooting, passing, dribbling, heading, defending, stamina }
--
-- This remaps every existing row's ratings across to the new keys (so returning
-- users keep their trained values) and backfills the new `stamina` attribute at
-- 50. The app performs the same migration client-side on load, so this is a
-- belt-and-braces backfill for rows that haven't been re-saved yet.
--
-- IDEMPOTENT: once migrated the new keys win (COALESCE prefers them), so running
-- it again is a no-op. ADDITIVE ONLY. Run once in the Supabase SQL editor.

update public.profiles
set skills = jsonb_build_object(
  'shooting',  coalesce((skills->>'shooting')::int,  (skills->>'kinematics')::int,    50),
  'passing',   coalesce((skills->>'passing')::int,   (skills->>'motion-graphs')::int, 50),
  'dribbling', coalesce((skills->>'dribbling')::int, (skills->>'forces')::int,        50),
  'heading',   coalesce((skills->>'heading')::int,   (skills->>'energy')::int,        50),
  'defending', coalesce((skills->>'defending')::int, (skills->>'momentum')::int,      50),
  'stamina',   coalesce((skills->>'stamina')::int,                                    50)
)
where skills is not null;

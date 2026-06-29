-- FIFA-Ultimate-Team-style club: your team is now 8 individually-rated players
-- instead of one blanket skill block. Each outfielder keeps the six game skills;
-- the goalkeeper has three GK stats (diving / handling / reflexes). The whole
-- roster is stored per user in a new `squad` jsonb column and drives every
-- player's match attributes.
--
-- This:
--   1. Adds profiles.squad (jsonb).
--   2. Backfills it for existing rows by spreading the player's old single skill
--      block across all seven outfielders (so a returning user's trained ratings
--      seed the whole team) and giving the keeper default 50s.
--
-- The app performs the same migration client-side on load and re-saves the squad,
-- so this is a belt-and-braces backfill. IDEMPOTENT (only fills rows where squad
-- is still null). ADDITIVE ONLY — run once in the Supabase SQL editor.

alter table public.profiles
  add column if not exists squad jsonb;

with mapped as (
  select
    username,
    jsonb_build_object(
      'shooting',  coalesce((skills->>'shooting')::int,  (skills->>'kinematics')::int,    50),
      'passing',   coalesce((skills->>'passing')::int,   (skills->>'motion-graphs')::int, 50),
      'dribbling', coalesce((skills->>'dribbling')::int, (skills->>'forces')::int,        50),
      'heading',   coalesce((skills->>'heading')::int,   (skills->>'energy')::int,        50),
      'defending', coalesce((skills->>'defending')::int, (skills->>'momentum')::int,      50),
      'stamina',   coalesce((skills->>'stamina')::int,                                    50)
    ) as stat
  from public.profiles
  where squad is null and skills is not null
)
update public.profiles p
set squad = jsonb_build_array(
  jsonb_build_object('id','s0','role','GK', 'num',1, 'name','Planck',
    'gk', jsonb_build_object('diving',50,'handling',50,'reflexes',50)),
  jsonb_build_object('id','s1','role','DEF','num',2, 'name','Bohr',    'stats', m.stat),
  jsonb_build_object('id','s2','role','DEF','num',5, 'name','Curie',   'stats', m.stat),
  jsonb_build_object('id','s3','role','MID','num',7, 'name','Maxwell', 'stats', m.stat),
  jsonb_build_object('id','s4','role','MID','num',6, 'name','Faraday', 'stats', m.stat),
  jsonb_build_object('id','s5','role','MID','num',8, 'name','Tesla',   'stats', m.stat),
  jsonb_build_object('id','s6','role','FWD','num',9, 'name','Galileo', 'stats', m.stat),
  jsonb_build_object('id','s7','role','FWD','num',10,'name','Newton',  'stats', m.stat)
)
from mapped m
where p.username = m.username;

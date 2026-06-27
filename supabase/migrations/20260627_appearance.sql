-- YOUR PLAYER's physical look (skin tone + hair colour) on the profiles row.
--
-- This is the same idea as equipped_jersey / equipped_cleats, but for the body's face.
-- It flows globally to the card portrait, the locker model and every drill so a player's
-- look is personalized + persisted (not hard-coded). Shape:
--
--   appearance -> { "skin": "fair", "hair": "brown" }   (palette ids, see lib/appearance.ts)
--
-- ADDITIVE ONLY — safe to run on top of the existing schema.
-- Run once in the Supabase SQL editor (Dashboard -> SQL -> New query).

alter table public.profiles
  add column if not exists appearance jsonb;

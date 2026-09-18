-- Authoritative league scoring defaults: 18-week season, 3/3/5 bonuses, 1/2/3/4 playoffs.
-- Never deletes Week 18 rows or picks. Safe if a temporary 17-week config was applied
-- locally, and a no-op for seasons already at 18 with customized scoring.

ALTER TABLE public.seasons
  ALTER COLUMN regular_week_count SET DEFAULT 18;

ALTER TABLE public.scoring_rules
  ALTER COLUMN best_record_bonus SET DEFAULT 3,
  ALTER COLUMN longest_streak_bonus SET DEFAULT 3,
  ALTER COLUMN survivor_bonus SET DEFAULT 5,
  ALTER COLUMN wildcard_points SET DEFAULT 1,
  ALTER COLUMN divisional_points SET DEFAULT 2,
  ALTER COLUMN conference_points SET DEFAULT 3,
  ALTER COLUMN superbowl_points SET DEFAULT 4;

-- Restore seasons that still carry the temporary 17-week configuration.
UPDATE public.seasons
SET regular_week_count = 18
WHERE regular_week_count = 17;

-- Align scoring rows that still match the prior Phase 2B-B defaults only.
-- Customized rows (any other combination) are left unchanged.
UPDATE public.scoring_rules
SET
  best_record_bonus = 3,
  longest_streak_bonus = 3,
  survivor_bonus = 5,
  wildcard_points = 1,
  divisional_points = 2,
  conference_points = 3,
  superbowl_points = 4
WHERE best_record_bonus = 4
  AND longest_streak_bonus = 4
  AND survivor_bonus = 10
  AND wildcard_points = 2
  AND divisional_points = 4
  AND conference_points = 6
  AND superbowl_points = 12;

-- Align playoff round point values that still match prior defaults per round.
UPDATE public.playoff_rounds
SET points = 1
WHERE round_code = 'wildcard' AND points = 2;

UPDATE public.playoff_rounds
SET points = 2
WHERE round_code = 'divisional' AND points = 4;

UPDATE public.playoff_rounds
SET points = 3
WHERE round_code = 'conference' AND points = 6;

UPDATE public.playoff_rounds
SET points = 4
WHERE round_code = 'superbowl' AND points = 12;

-- Authoritative league scoring defaults: 18-week season, 4/4/10 bonuses, 2/4/6/12 playoffs.
-- Never deletes Week 18 rows or picks.
-- Safe whether or not temporary unpublished 3/3/5 and 1/2/3/4 values were applied locally.

ALTER TABLE public.seasons
  ALTER COLUMN regular_week_count SET DEFAULT 18;

ALTER TABLE public.scoring_rules
  ALTER COLUMN correct_regular_pick_points SET DEFAULT 1,
  ALTER COLUMN best_record_bonus SET DEFAULT 4,
  ALTER COLUMN longest_streak_bonus SET DEFAULT 4,
  ALTER COLUMN survivor_bonus SET DEFAULT 10,
  ALTER COLUMN wildcard_points SET DEFAULT 2,
  ALTER COLUMN divisional_points SET DEFAULT 4,
  ALTER COLUMN conference_points SET DEFAULT 6,
  ALTER COLUMN superbowl_points SET DEFAULT 12,
  ALTER COLUMN perfect_season_override SET DEFAULT true;

-- Restore seasons that still carry a temporary 17-week configuration.
UPDATE public.seasons
SET regular_week_count = 18
WHERE regular_week_count = 17;

-- Undo temporary unpublished-branch scoring (3/3/5 + 1/2/3/4) back to spreadsheet values.
UPDATE public.scoring_rules
SET
  correct_regular_pick_points = 1,
  best_record_bonus = 4,
  longest_streak_bonus = 4,
  survivor_bonus = 10,
  wildcard_points = 2,
  divisional_points = 4,
  conference_points = 6,
  superbowl_points = 12,
  perfect_season_override = true
WHERE best_record_bonus = 3
  AND longest_streak_bonus = 3
  AND survivor_bonus = 5
  AND wildcard_points = 1
  AND divisional_points = 2
  AND conference_points = 3
  AND superbowl_points = 4;

-- Align any remaining legacy non-spreadsheet defaults that exactly match the old 0-bonus shape
-- is unnecessary: schema/history already used 4/4/10. Preserve customized rows.

-- Align temporary playoff round points back to spreadsheet values.
UPDATE public.playoff_rounds
SET points = 2
WHERE round_code = 'wildcard' AND points = 1;

UPDATE public.playoff_rounds
SET points = 4
WHERE round_code = 'divisional' AND points = 2;

UPDATE public.playoff_rounds
SET points = 6
WHERE round_code = 'conference' AND points = 3;

UPDATE public.playoff_rounds
SET points = 12
WHERE round_code = 'superbowl' AND points = 4;

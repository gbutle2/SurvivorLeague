-- Repeatable seed of all 32 NFL teams.
-- Safe to re-run: upserts on abbreviation.

INSERT INTO public.teams (abbreviation, city, name, conference, division, active)
VALUES
  ('ARI', 'Arizona', 'Cardinals', 'NFC', 'West', true),
  ('ATL', 'Atlanta', 'Falcons', 'NFC', 'South', true),
  ('BAL', 'Baltimore', 'Ravens', 'AFC', 'North', true),
  ('BUF', 'Buffalo', 'Bills', 'AFC', 'East', true),
  ('CAR', 'Carolina', 'Panthers', 'NFC', 'South', true),
  ('CHI', 'Chicago', 'Bears', 'NFC', 'North', true),
  ('CIN', 'Cincinnati', 'Bengals', 'AFC', 'North', true),
  ('CLE', 'Cleveland', 'Browns', 'AFC', 'North', true),
  ('DAL', 'Dallas', 'Cowboys', 'NFC', 'East', true),
  ('DEN', 'Denver', 'Broncos', 'AFC', 'West', true),
  ('DET', 'Detroit', 'Lions', 'NFC', 'North', true),
  ('GB', 'Green Bay', 'Packers', 'NFC', 'North', true),
  ('HOU', 'Houston', 'Texans', 'AFC', 'South', true),
  ('IND', 'Indianapolis', 'Colts', 'AFC', 'South', true),
  ('JAX', 'Jacksonville', 'Jaguars', 'AFC', 'South', true),
  ('KC', 'Kansas City', 'Chiefs', 'AFC', 'West', true),
  ('LAC', 'Los Angeles', 'Chargers', 'AFC', 'West', true),
  ('LAR', 'Los Angeles', 'Rams', 'NFC', 'West', true),
  ('LV', 'Las Vegas', 'Raiders', 'AFC', 'West', true),
  ('MIA', 'Miami', 'Dolphins', 'AFC', 'East', true),
  ('MIN', 'Minnesota', 'Vikings', 'NFC', 'North', true),
  ('NE', 'New England', 'Patriots', 'AFC', 'East', true),
  ('NO', 'New Orleans', 'Saints', 'NFC', 'South', true),
  ('NYG', 'New York', 'Giants', 'NFC', 'East', true),
  ('NYJ', 'New York', 'Jets', 'AFC', 'East', true),
  ('PHI', 'Philadelphia', 'Eagles', 'NFC', 'East', true),
  ('PIT', 'Pittsburgh', 'Steelers', 'AFC', 'North', true),
  ('SEA', 'Seattle', 'Seahawks', 'NFC', 'West', true),
  ('SF', 'San Francisco', '49ers', 'NFC', 'West', true),
  ('TB', 'Tampa Bay', 'Buccaneers', 'NFC', 'South', true),
  ('TEN', 'Tennessee', 'Titans', 'AFC', 'South', true),
  ('WAS', 'Washington', 'Commanders', 'NFC', 'East', true)
ON CONFLICT (abbreviation) DO UPDATE
SET
  city = EXCLUDED.city,
  name = EXCLUDED.name,
  conference = EXCLUDED.conference,
  division = EXCLUDED.division,
  active = EXCLUDED.active;

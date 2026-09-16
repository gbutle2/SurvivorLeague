-- Enforce at most one open regular-season week per season.
-- Application checks remain; this index is the authoritative concurrency guard.
-- Do not apply to remote production without explicit approval.

CREATE UNIQUE INDEX weeks_one_open_per_season_idx
ON public.weeks (season_id)
WHERE status = 'open';

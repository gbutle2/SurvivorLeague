-- League chat, DMs, activity events, and in-app notifications.
-- Forward-only. Does not grant commissioners access to private DMs.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE public.conversation_type AS ENUM ('league', 'direct');

CREATE TYPE public.message_kind AS ENUM ('user', 'system');

CREATE TYPE public.league_event_type AS ENUM (
  'pick_submitted',
  'pick_updated',
  'commissioner_pick_changed',
  'week_opened',
  'week_locked',
  'picks_revealed',
  'result_entered',
  'result_corrected',
  'survivor_eliminated',
  'season_activated',
  'season_deactivated',
  'member_added',
  'member_removed',
  'commissioner_announcement'
);

CREATE TYPE public.notification_type AS ENUM (
  'direct_message',
  'commissioner_pick_changed',
  'week_opened',
  'week_locked',
  'commissioner_announcement',
  'survivor_eliminated'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues (id) ON DELETE CASCADE,
  type public.conversation_type NOT NULL,
  -- For DMs: canonical unordered pair (user_low < user_high).
  dm_user_low UUID REFERENCES public.profiles (id),
  dm_user_high UUID REFERENCES public.profiles (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT conversations_dm_pair_order CHECK (
    type <> 'direct'
    OR (dm_user_low IS NOT NULL AND dm_user_high IS NOT NULL AND dm_user_low < dm_user_high)
  ),
  CONSTRAINT conversations_league_no_dm_users CHECK (
    type <> 'league'
    OR (dm_user_low IS NULL AND dm_user_high IS NULL)
  )
);

CREATE UNIQUE INDEX conversations_one_league_chat_idx
  ON public.conversations (league_id)
  WHERE type = 'league';

CREATE UNIQUE INDEX conversations_one_dm_pair_idx
  ON public.conversations (league_id, dm_user_low, dm_user_high)
  WHERE type = 'direct';

CREATE INDEX conversations_league_id_idx ON public.conversations (league_id);

CREATE TABLE public.league_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues (id) ON DELETE CASCADE,
  season_id UUID REFERENCES public.seasons (id) ON DELETE SET NULL,
  week_id UUID REFERENCES public.weeks (id) ON DELETE SET NULL,
  event_type public.league_event_type NOT NULL,
  actor_user_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  affected_user_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  actor_display_name TEXT,
  affected_display_name TEXT,
  domain_table TEXT,
  domain_record_id UUID,
  -- Always-safe public fields (week number, etc.). Never put unrevealed team ids here.
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Team ids and other sensitive fields. Not granted to authenticated SELECT.
  sensitive_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_revealed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  CONSTRAINT league_events_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE INDEX league_events_league_created_idx
  ON public.league_events (league_id, created_at DESC);

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES public.leagues (id) ON DELETE CASCADE,
  kind public.message_kind NOT NULL,
  author_user_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  author_display_name TEXT,
  body TEXT,
  league_event_id UUID REFERENCES public.league_events (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  idempotency_key TEXT,
  CONSTRAINT messages_user_has_author CHECK (
    kind <> 'user' OR author_user_id IS NOT NULL
  ),
  CONSTRAINT messages_system_no_author_spoof CHECK (
    kind <> 'system' OR author_user_id IS NULL
  ),
  CONSTRAINT messages_body_length CHECK (
    body IS NULL OR char_length(body) <= 2000
  ),
  CONSTRAINT messages_user_body_required CHECK (
    kind <> 'user'
    OR deleted_at IS NOT NULL
    OR (body IS NOT NULL AND length(trim(body)) > 0)
  )
);

CREATE UNIQUE INDEX messages_idempotency_key_uidx
  ON public.messages (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX messages_conversation_created_idx
  ON public.messages (conversation_id, created_at);

CREATE INDEX messages_league_created_idx
  ON public.messages (league_id, created_at DESC);

CREATE TABLE public.conversation_read_states (
  conversation_id UUID NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT 'epoch'::timestamptz,
  last_read_message_id UUID REFERENCES public.messages (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES public.leagues (id) ON DELETE CASCADE,
  notification_type public.notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  link_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  CONSTRAINT notifications_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE INDEX notifications_recipient_created_idx
  ON public.notifications (recipient_user_id, created_at DESC);

CREATE INDEX notifications_recipient_unread_idx
  ON public.notifications (recipient_user_id)
  WHERE read_at IS NULL;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND (
        (
          c.type = 'league'
          AND public.is_active_league_member(c.league_id)
        )
        OR (
          c.type = 'direct'
          AND public.is_active_league_member(c.league_id)
          AND auth.uid() IN (c.dm_user_low, c.dm_user_high)
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_conversation_participant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_conversation_participant(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_league_conversation(p_league_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_league_member(p_league_id) THEN
    RAISE EXCEPTION 'Not an active league member' USING ERRCODE = '42501';
  END IF;

  SELECT c.id INTO v_id
  FROM public.conversations c
  WHERE c.league_id = p_league_id AND c.type = 'league';

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.conversations (league_id, type)
  VALUES (p_league_id, 'league')
  ON CONFLICT (league_id) WHERE (type = 'league') DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT c.id INTO v_id
    FROM public.conversations c
    WHERE c.league_id = p_league_id AND c.type = 'league';
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_league_conversation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_league_conversation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_direct_conversation(
  p_league_id UUID,
  p_other_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_self UUID := auth.uid();
  v_low UUID;
  v_high UUID;
  v_id UUID;
BEGIN
  IF v_self IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_other_user_id IS NULL OR p_other_user_id = v_self THEN
    RAISE EXCEPTION 'Invalid DM participant' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_active_league_member(p_league_id) THEN
    RAISE EXCEPTION 'Not an active league member' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.league_members lm
    WHERE lm.league_id = p_league_id
      AND lm.user_id = p_other_user_id
      AND lm.active = true
  ) THEN
    RAISE EXCEPTION 'Other user is not an active league member' USING ERRCODE = '42501';
  END IF;

  IF v_self < p_other_user_id THEN
    v_low := v_self;
    v_high := p_other_user_id;
  ELSE
    v_low := p_other_user_id;
    v_high := v_self;
  END IF;

  SELECT c.id INTO v_id
  FROM public.conversations c
  WHERE c.league_id = p_league_id
    AND c.type = 'direct'
    AND c.dm_user_low = v_low
    AND c.dm_user_high = v_high;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.conversations (league_id, type, dm_user_low, dm_user_high)
  VALUES (p_league_id, 'direct', v_low, v_high)
  ON CONFLICT (league_id, dm_user_low, dm_user_high) WHERE (type = 'direct') DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT c.id INTO v_id
    FROM public.conversations c
    WHERE c.league_id = p_league_id
      AND c.type = 'direct'
      AND c.dm_user_low = v_low
      AND c.dm_user_high = v_high;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_direct_conversation(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_direct_conversation(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.profile_display_name(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(nullif(trim(p.display_name), ''), 'Member')
  FROM public.profiles p
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.profile_display_name(UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.pick_is_revealed_to_peers(p_pick_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.picks p
    INNER JOIN public.weeks w ON w.id = p.week_id
    LEFT JOIN public.games g ON g.id = p.game_id
    WHERE p.id = p_pick_id
      AND (
        (g.id IS NOT NULL AND g.scheduled_kickoff_at <= now())
        OR (p.game_id IS NULL AND w.locks_at IS NOT NULL AND w.locks_at <= now())
      )
  );
$$;

REVOKE ALL ON FUNCTION public.pick_is_revealed_to_peers(UUID) FROM PUBLIC;

-- Canonical event + optional league system message + optional private notification.
CREATE OR REPLACE FUNCTION public.record_league_event(
  p_league_id UUID,
  p_season_id UUID,
  p_week_id UUID,
  p_event_type public.league_event_type,
  p_actor_user_id UUID,
  p_affected_user_id UUID,
  p_domain_table TEXT,
  p_domain_record_id UUID,
  p_payload JSONB,
  p_sensitive_payload JSONB,
  p_is_revealed BOOLEAN,
  p_idempotency_key TEXT,
  p_post_to_league_chat BOOLEAN DEFAULT true,
  p_notify_user_id UUID DEFAULT NULL,
  p_notification_type public.notification_type DEFAULT NULL,
  p_notification_title TEXT DEFAULT NULL,
  p_notification_body TEXT DEFAULT NULL,
  p_notification_link TEXT DEFAULT NULL,
  p_notification_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_conversation_id UUID;
BEGIN
  -- Not granted to authenticated; only triggers / service-role callers invoke this.
  INSERT INTO public.league_events (
    league_id, season_id, week_id, event_type,
    actor_user_id, affected_user_id,
    actor_display_name, affected_display_name,
    domain_table, domain_record_id,
    payload, sensitive_payload, is_revealed, idempotency_key
  )
  VALUES (
    p_league_id, p_season_id, p_week_id, p_event_type,
    p_actor_user_id, p_affected_user_id,
    CASE WHEN p_actor_user_id IS NULL THEN NULL ELSE public.profile_display_name(p_actor_user_id) END,
    CASE WHEN p_affected_user_id IS NULL THEN NULL ELSE public.profile_display_name(p_affected_user_id) END,
    p_domain_table, p_domain_record_id,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_sensitive_payload, '{}'::jsonb),
    coalesce(p_is_revealed, false),
    p_idempotency_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id
    FROM public.league_events
    WHERE idempotency_key = p_idempotency_key;
    RETURN v_event_id;
  END IF;

  IF p_post_to_league_chat THEN
    v_conversation_id := public.ensure_league_conversation(p_league_id);
    INSERT INTO public.messages (
      conversation_id, league_id, kind, author_user_id, author_display_name,
      body, league_event_id, idempotency_key
    )
    VALUES (
      v_conversation_id, p_league_id, 'system', NULL, NULL,
      NULL, v_event_id, 'system_msg:' || p_idempotency_key
    )
    ON CONFLICT (idempotency_key) WHERE (idempotency_key IS NOT NULL) DO NOTHING;
  END IF;

  IF p_notify_user_id IS NOT NULL
     AND p_notification_type IS NOT NULL
     AND p_notification_title IS NOT NULL
     AND p_notification_body IS NOT NULL THEN
    INSERT INTO public.notifications (
      recipient_user_id, league_id, notification_type,
      title, body, payload, link_path, idempotency_key
    )
    VALUES (
      p_notify_user_id, p_league_id, p_notification_type,
      p_notification_title, p_notification_body,
      coalesce(p_notification_payload, '{}'::jsonb),
      p_notification_link,
      'notif:' || p_idempotency_key
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_league_event(
  UUID, UUID, UUID, public.league_event_type, UUID, UUID, TEXT, UUID,
  JSONB, JSONB, BOOLEAN, TEXT, BOOLEAN, UUID, public.notification_type,
  TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Pick mutation → events (privacy-safe)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_picks_record_league_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league_id UUID;
  v_season_id UUID;
  v_week_number INT;
  v_revealed BOOLEAN;
  v_key TEXT;
  v_commissioner BOOLEAN;
  v_actor UUID;
BEGIN
  SELECT s.league_id, s.id, w.week_number
  INTO v_league_id, v_season_id, v_week_number
  FROM public.weeks w
  INNER JOIN public.seasons s ON s.id = w.season_id
  WHERE w.id = NEW.week_id;

  IF v_league_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_commissioner := public.commissioner_override_pick_active();
  v_actor := CASE
    WHEN v_commissioner THEN auth.uid()
    ELSE NEW.user_id
  END;

  IF TG_OP = 'INSERT' THEN
    v_revealed := public.pick_is_revealed_to_peers(NEW.id);
    v_key := 'pick_submitted:' || NEW.id::text;

    IF v_commissioner THEN
      PERFORM public.record_league_event(
        v_league_id, v_season_id, NEW.week_id,
        'commissioner_pick_changed',
        v_actor, NEW.user_id,
        'picks', NEW.id,
        jsonb_build_object('week_number', v_week_number, 'action', 'set'),
        jsonb_build_object('team_id', NEW.team_id),
        v_revealed,
        v_key,
        true,
        NEW.user_id,
        'commissioner_pick_changed',
        'Pick updated by commissioner',
        'The commissioner set your Week ' || v_week_number::text || ' pick.',
        '/pick',
        jsonb_build_object('week_number', v_week_number, 'team_id', NEW.team_id)
      );
    ELSE
      PERFORM public.record_league_event(
        v_league_id, v_season_id, NEW.week_id,
        'pick_submitted',
        NEW.user_id, NEW.user_id,
        'picks', NEW.id,
        jsonb_build_object('week_number', v_week_number),
        jsonb_build_object('team_id', NEW.team_id),
        v_revealed,
        v_key,
        true, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb
      );
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.team_id IS DISTINCT FROM NEW.team_id THEN
    v_revealed := public.pick_is_revealed_to_peers(NEW.id);
    v_key := 'pick_team:' || NEW.id::text || ':' || NEW.updated_at::text;

    IF v_commissioner THEN
      PERFORM public.record_league_event(
        v_league_id, v_season_id, NEW.week_id,
        'commissioner_pick_changed',
        v_actor, NEW.user_id,
        'picks', NEW.id,
        jsonb_build_object('week_number', v_week_number, 'action', 'change'),
        jsonb_build_object(
          'team_id', NEW.team_id,
          'previous_team_id', OLD.team_id
        ),
        v_revealed,
        v_key,
        true,
        NEW.user_id,
        'commissioner_pick_changed',
        'Pick changed by commissioner',
        'The commissioner changed your Week ' || v_week_number::text || ' pick.',
        '/pick',
        jsonb_build_object(
          'week_number', v_week_number,
          'team_id', NEW.team_id,
          'previous_team_id', OLD.team_id
        )
      );
    ELSE
      PERFORM public.record_league_event(
        v_league_id, v_season_id, NEW.week_id,
        'pick_updated',
        NEW.user_id, NEW.user_id,
        'picks', NEW.id,
        jsonb_build_object('week_number', v_week_number),
        jsonb_build_object(
          'team_id', NEW.team_id,
          'previous_team_id', OLD.team_id
        ),
        v_revealed,
        v_key,
        true, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb
      );
    END IF;
  END IF;

  IF OLD.result IS DISTINCT FROM NEW.result
     AND NEW.result IN ('win', 'loss', 'tie') THEN
    v_key := 'pick_result:' || NEW.id::text || ':' || NEW.result::text || ':' || NEW.updated_at::text;
    PERFORM public.record_league_event(
      v_league_id, v_season_id, NEW.week_id,
      CASE
        WHEN OLD.result = 'pending' THEN 'result_entered'::public.league_event_type
        ELSE 'result_corrected'::public.league_event_type
      END,
      NULL, NEW.user_id,
      'picks', NEW.id,
      jsonb_build_object(
        'week_number', v_week_number,
        'result', NEW.result
      ),
      jsonb_build_object('team_id', NEW.team_id),
      true,
      v_key,
      true, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb
    );

    IF NEW.result IN ('loss', 'tie') AND OLD.result = 'pending' THEN
      PERFORM public.record_league_event(
        v_league_id, v_season_id, NEW.week_id,
        'survivor_eliminated',
        NULL, NEW.user_id,
        'picks', NEW.id,
        jsonb_build_object('week_number', v_week_number, 'result', NEW.result),
        '{}'::jsonb,
        true,
        'survivor_elim:' || NEW.id::text,
        true,
        NEW.user_id,
        'survivor_eliminated',
        'Eliminated from Survivor',
        'You were eliminated from Survivor in Week ' || v_week_number::text || '.',
        '/',
        jsonb_build_object('week_number', v_week_number)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_picks_record_league_events() FROM PUBLIC;

CREATE TRIGGER picks_record_league_events
  AFTER INSERT OR UPDATE OF team_id, result, updated_at ON public.picks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_picks_record_league_events();

-- Reveal sensitive presentation when kickoff makes the pick public.
CREATE OR REPLACE FUNCTION public.trg_games_reveal_pick_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.scheduled_kickoff_at IS DISTINCT FROM NEW.scheduled_kickoff_at THEN
    RETURN NEW;
  END IF;

  IF NEW.scheduled_kickoff_at <= now() THEN
    UPDATE public.league_events le
    SET
      is_revealed = true,
      payload = le.payload
        || jsonb_build_object(
          'team_id', le.sensitive_payload ->> 'team_id',
          'previous_team_id', le.sensitive_payload ->> 'previous_team_id'
        )
    WHERE le.domain_table = 'picks'
      AND le.domain_record_id IN (
        SELECT p.id FROM public.picks p WHERE p.game_id = NEW.id
      )
      AND le.is_revealed = false
      AND le.event_type IN (
        'pick_submitted', 'pick_updated', 'commissioner_pick_changed'
      );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_games_reveal_pick_events() FROM PUBLIC;

CREATE TRIGGER games_reveal_pick_events
  AFTER UPDATE OF status, scheduled_kickoff_at, home_score, away_score ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_games_reveal_pick_events();

-- Week status transitions
CREATE OR REPLACE FUNCTION public.trg_weeks_record_league_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league_id UUID;
  v_season_id UUID;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT s.league_id, s.id INTO v_league_id, v_season_id
  FROM public.seasons s
  WHERE s.id = NEW.season_id;

  IF NEW.status = 'open' AND OLD.status IS DISTINCT FROM 'open' THEN
    PERFORM public.record_league_event(
      v_league_id, v_season_id, NEW.id,
      'week_opened', auth.uid(), NULL,
      'weeks', NEW.id,
      jsonb_build_object('week_number', NEW.week_number),
      '{}'::jsonb, true,
      'week_opened:' || NEW.id::text || ':' || NEW.status::text,
      true, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb
    );
  ELSIF NEW.status = 'locked' AND OLD.status IS DISTINCT FROM 'locked' THEN
    PERFORM public.record_league_event(
      v_league_id, v_season_id, NEW.id,
      'week_locked', auth.uid(), NULL,
      'weeks', NEW.id,
      jsonb_build_object('week_number', NEW.week_number),
      '{}'::jsonb, true,
      'week_locked:' || NEW.id::text,
      true, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_weeks_record_league_events() FROM PUBLIC;

CREATE TRIGGER weeks_record_league_events
  AFTER UPDATE OF status ON public.weeks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_weeks_record_league_events();

-- Season activation
CREATE OR REPLACE FUNCTION public.trg_seasons_record_league_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    PERFORM public.record_league_event(
      NEW.league_id, NEW.id, NULL,
      'season_activated', auth.uid(), NULL,
      'seasons', NEW.id,
      jsonb_build_object('year', NEW.year),
      '{}'::jsonb, true,
      'season_activated:' || NEW.id::text,
      true, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb
    );
  ELSIF NEW.status IS DISTINCT FROM 'active' AND OLD.status = 'active' THEN
    PERFORM public.record_league_event(
      NEW.league_id, NEW.id, NULL,
      'season_deactivated', auth.uid(), NULL,
      'seasons', NEW.id,
      jsonb_build_object('year', NEW.year, 'status', NEW.status),
      '{}'::jsonb, true,
      'season_deactivated:' || NEW.id::text || ':' || NEW.status::text,
      true, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_seasons_record_league_events() FROM PUBLIC;

CREATE TRIGGER seasons_record_league_events
  AFTER UPDATE OF status ON public.seasons
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_seasons_record_league_events();

-- Membership changes
CREATE OR REPLACE FUNCTION public.trg_members_record_league_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.active THEN
    PERFORM public.record_league_event(
      NEW.league_id, NULL, NULL,
      'member_added', auth.uid(), NEW.user_id,
      'league_members', NULL,
      jsonb_build_object('role', NEW.role),
      '{}'::jsonb, true,
      'member_added:' || NEW.league_id::text || ':' || NEW.user_id::text || ':' || NEW.joined_at::text,
      true, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.active IS DISTINCT FROM NEW.active AND NEW.active = false THEN
    PERFORM public.record_league_event(
      NEW.league_id, NULL, NULL,
      'member_removed', auth.uid(), NEW.user_id,
      'league_members', NULL,
      jsonb_build_object('role', NEW.role),
      '{}'::jsonb, true,
      'member_removed:' || NEW.league_id::text || ':' || NEW.user_id::text || ':' || now()::text,
      true, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_members_record_league_events() FROM PUBLIC;

CREATE TRIGGER members_record_league_events
  AFTER INSERT OR UPDATE OF active ON public.league_members
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_members_record_league_events();

-- ---------------------------------------------------------------------------
-- Message RPCs (author enforcement)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_conversation_message(
  p_conversation_id UUID,
  p_body TEXT,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.messages;
  v_league_id UUID;
  v_body TEXT := trim(coalesce(p_body, ''));
  v_other UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_body = '' OR char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'Invalid message body' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_conversation_participant(p_conversation_id) THEN
    RAISE EXCEPTION 'Not a conversation participant' USING ERRCODE = '42501';
  END IF;

  SELECT c.league_id INTO v_league_id
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  INSERT INTO public.messages (
    conversation_id, league_id, kind, author_user_id, author_display_name,
    body, idempotency_key
  )
  VALUES (
    p_conversation_id, v_league_id, 'user', auth.uid(),
    public.profile_display_name(auth.uid()),
    v_body, nullif(trim(coalesce(p_idempotency_key, '')), '')
  )
  ON CONFLICT (idempotency_key) WHERE (idempotency_key IS NOT NULL) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_row FROM public.messages WHERE idempotency_key = p_idempotency_key;
  END IF;

  -- DM notification for the other participant
  SELECT CASE
    WHEN c.type = 'direct' AND c.dm_user_low = auth.uid() THEN c.dm_user_high
    WHEN c.type = 'direct' AND c.dm_user_high = auth.uid() THEN c.dm_user_low
    ELSE NULL
  END INTO v_other
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  IF v_other IS NOT NULL AND v_row.id IS NOT NULL THEN
    INSERT INTO public.notifications (
      recipient_user_id, league_id, notification_type,
      title, body, payload, link_path, idempotency_key
    )
    VALUES (
      v_other, v_league_id, 'direct_message',
      'New message',
      left(v_body, 120),
      jsonb_build_object('conversation_id', p_conversation_id, 'message_id', v_row.id),
      NULL,
      'notif:dm:' || v_row.id::text
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.send_conversation_message(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_conversation_message(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.edit_own_message(
  p_message_id UUID,
  p_body TEXT
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.messages;
  v_body TEXT := trim(coalesce(p_body, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_body = '' OR char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'Invalid message body' USING ERRCODE = '22023';
  END IF;

  UPDATE public.messages m
  SET body = v_body, edited_at = now()
  WHERE m.id = p_message_id
    AND m.kind = 'user'
    AND m.author_user_id = auth.uid()
    AND m.deleted_at IS NULL
    AND public.is_conversation_participant(m.conversation_id)
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Message not editable' USING ERRCODE = '42501';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_own_message(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_own_message(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.soft_delete_own_message(p_message_id UUID)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.messages;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.messages m
  SET deleted_at = now(), body = NULL
  WHERE m.id = p_message_id
    AND m.kind = 'user'
    AND m.author_user_id = auth.uid()
    AND m.deleted_at IS NULL
    AND public.is_conversation_participant(m.conversation_id)
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Message not deletable' USING ERRCODE = '42501';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_own_message(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_own_message(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  p_conversation_id UUID,
  p_message_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_read_at TIMESTAMPTZ := now();
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_conversation_participant(p_conversation_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_message_id IS NOT NULL THEN
    SELECT m.created_at INTO v_read_at
    FROM public.messages m
    WHERE m.id = p_message_id AND m.conversation_id = p_conversation_id;
    IF v_read_at IS NULL THEN
      v_read_at := now();
    END IF;
  END IF;

  INSERT INTO public.conversation_read_states (
    conversation_id, user_id, last_read_at, last_read_message_id, updated_at
  )
  VALUES (p_conversation_id, auth.uid(), v_read_at, p_message_id, now())
  ON CONFLICT (conversation_id, user_id) DO UPDATE
  SET
    last_read_at = GREATEST(conversation_read_states.last_read_at, EXCLUDED.last_read_at),
    last_read_message_id = coalesce(EXCLUDED.last_read_message_id, conversation_read_states.last_read_message_id),
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_conversation_read(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notifications n
  SET read_at = coalesce(n.read_at, now())
  WHERE n.id = p_notification_id
    AND n.recipient_user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notification_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_league_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NOT public.is_active_league_member(p_league_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.notifications n
  SET read_at = now()
  WHERE n.recipient_user_id = auth.uid()
    AND n.league_id = p_league_id
    AND n.read_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_all_notifications_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_read_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_select_participant
  ON public.conversations FOR SELECT TO authenticated
  USING (public.is_conversation_participant(id));

-- No direct INSERT/UPDATE/DELETE for authenticated; use ensure_* RPCs (DEFINER).

CREATE POLICY messages_select_participant
  ON public.messages FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id));

-- No direct message writes; send/edit/delete RPCs only.

CREATE POLICY league_events_select_member
  ON public.league_events FOR SELECT TO authenticated
  USING (public.is_active_league_member(league_id));

CREATE POLICY conversation_read_states_select_own
  ON public.conversation_read_states FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND public.is_conversation_participant(conversation_id)
  );

CREATE POLICY notifications_select_own
  ON public.notifications FOR SELECT TO authenticated
  USING (
    recipient_user_id = auth.uid()
    AND public.is_active_league_member(league_id)
  );

-- Column privileges: hide sensitive_payload from clients
REVOKE ALL ON TABLE public.league_events FROM PUBLIC;
REVOKE ALL ON TABLE public.league_events FROM authenticated;
GRANT SELECT (
  id, league_id, season_id, week_id, event_type,
  actor_user_id, affected_user_id,
  actor_display_name, affected_display_name,
  domain_table, domain_record_id,
  payload, is_revealed, created_at, idempotency_key
) ON public.league_events TO authenticated;

REVOKE ALL ON TABLE public.conversations FROM PUBLIC;
GRANT SELECT ON TABLE public.conversations TO authenticated;

REVOKE ALL ON TABLE public.messages FROM PUBLIC;
GRANT SELECT ON TABLE public.messages TO authenticated;

REVOKE ALL ON TABLE public.conversation_read_states FROM PUBLIC;
GRANT SELECT ON TABLE public.conversation_read_states TO authenticated;

REVOKE ALL ON TABLE public.notifications FROM PUBLIC;
GRANT SELECT ON TABLE public.notifications TO authenticated;

-- Seed league conversations for existing leagues
INSERT INTO public.conversations (league_id, type)
SELECT l.id, 'league'::public.conversation_type
FROM public.leagues l
ON CONFLICT (league_id) WHERE (type = 'league') DO NOTHING;

-- Realtime
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;

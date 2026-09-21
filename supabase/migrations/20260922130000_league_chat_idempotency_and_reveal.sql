-- Correct league-chat idempotency isolation, revealed payloads, and kickoff reveal.
-- Forward-only fix for 20260922120000_league_chat_notifications.sql

-- ---------------------------------------------------------------------------
-- 1. Message idempotency: separate client vs system namespaces
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS public.messages_idempotency_key_uidx;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS system_idempotency_key TEXT;

-- Migrate existing rows (best-effort for local environments that applied the prior migration).
UPDATE public.messages
SET system_idempotency_key = idempotency_key
WHERE kind = 'system'
  AND idempotency_key IS NOT NULL
  AND system_idempotency_key IS NULL;

UPDATE public.messages
SET client_idempotency_key = idempotency_key
WHERE kind = 'user'
  AND idempotency_key IS NOT NULL
  AND client_idempotency_key IS NULL;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_system_no_author_spoof;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_user_has_author;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_user_body_required;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_kind_columns_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_kind_columns_check CHECK (
    (
      kind = 'user'
      AND author_user_id IS NOT NULL
      AND system_idempotency_key IS NULL
      AND league_event_id IS NULL
      AND (
        deleted_at IS NOT NULL
        OR (body IS NOT NULL AND length(trim(body)) > 0)
      )
    )
    OR (
      kind = 'system'
      AND author_user_id IS NULL
      AND client_idempotency_key IS NULL
    )
  );

CREATE UNIQUE INDEX messages_client_idempotency_uidx
  ON public.messages (conversation_id, author_user_id, client_idempotency_key)
  WHERE kind = 'user' AND client_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX messages_system_idempotency_uidx
  ON public.messages (system_idempotency_key)
  WHERE kind = 'system' AND system_idempotency_key IS NOT NULL;

ALTER TABLE public.messages
  DROP COLUMN IF EXISTS idempotency_key;

-- ---------------------------------------------------------------------------
-- 2. record_league_event: copy team ids into public payload when already revealed
-- ---------------------------------------------------------------------------

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
  v_public_payload JSONB := coalesce(p_payload, '{}'::jsonb);
  v_sensitive JSONB := coalesce(p_sensitive_payload, '{}'::jsonb);
  v_revealed BOOLEAN := coalesce(p_is_revealed, false);
BEGIN
  -- When already revealed, public payload must carry permitted team ids immediately.
  IF v_revealed THEN
    v_public_payload := v_public_payload || jsonb_strip_nulls(
      jsonb_build_object(
        'team_id', nullif(v_sensitive ->> 'team_id', ''),
        'previous_team_id', nullif(v_sensitive ->> 'previous_team_id', '')
      )
    );
  ELSE
    -- Defense in depth: never leave team ids in the public payload while hidden.
    v_public_payload := v_public_payload - 'team_id' - 'previous_team_id'
      - 'team_abbreviation' - 'previous_team_abbreviation'
      - 'team_name' - 'previous_team_name';
  END IF;

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
    v_public_payload,
    v_sensitive,
    v_revealed,
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
      body, league_event_id, system_idempotency_key
    )
    VALUES (
      v_conversation_id, p_league_id, 'system', NULL, NULL,
      NULL, v_event_id, 'system_msg:' || p_idempotency_key
    )
    ON CONFLICT (system_idempotency_key)
      WHERE (kind = 'system' AND system_idempotency_key IS NOT NULL)
      DO NOTHING;
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
-- 3. Idempotent reveal of eligible pick events (same rule as pick visibility)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reveal_eligible_pick_events()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  WITH eligible AS (
    SELECT le.id
    FROM public.league_events le
    WHERE le.is_revealed = false
      AND le.domain_table = 'picks'
      AND le.domain_record_id IS NOT NULL
      AND le.event_type IN (
        'pick_submitted', 'pick_updated', 'commissioner_pick_changed'
      )
      AND public.pick_is_revealed_to_peers(le.domain_record_id)
  ),
  updated AS (
    UPDATE public.league_events le
    SET
      is_revealed = true,
      payload = le.payload || jsonb_strip_nulls(
        jsonb_build_object(
          'team_id', nullif(le.sensitive_payload ->> 'team_id', ''),
          'previous_team_id', nullif(le.sensitive_payload ->> 'previous_team_id', '')
        )
      )
    FROM eligible e
    WHERE le.id = e.id
    RETURNING le.id
  )
  SELECT count(*)::integer INTO v_count FROM updated;

  RETURN coalesce(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.reveal_eligible_pick_events() FROM PUBLIC;
-- Invoked by game triggers and the NFL sync Node path (service/DB owner).
-- Not granted to authenticated clients.

CREATE OR REPLACE FUNCTION public.trg_games_reveal_pick_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Time passage alone does not fire this trigger; reveal_eligible_pick_events
  -- is also invoked from NFL schedule sync. Still run on game mutations that
  -- may accompany kickoff/status/score updates.
  PERFORM public.reveal_eligible_pick_events();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_games_reveal_pick_events() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. send_conversation_message: scoped client idempotency only
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.send_conversation_message(UUID, TEXT, TEXT);

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
  v_key TEXT := nullif(trim(coalesce(p_idempotency_key, '')), '');
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

  -- Clients may not occupy the system-message namespace.
  IF v_key IS NOT NULL AND lower(v_key) LIKE 'system_msg:%' THEN
    RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE = '22023';
  END IF;

  SELECT c.league_id INTO v_league_id
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  INSERT INTO public.messages (
    conversation_id, league_id, kind, author_user_id, author_display_name,
    body, client_idempotency_key
  )
  VALUES (
    p_conversation_id, v_league_id, 'user', auth.uid(),
    public.profile_display_name(auth.uid()),
    v_body, v_key
  )
  ON CONFLICT (conversation_id, author_user_id, client_idempotency_key)
    WHERE (kind = 'user' AND client_idempotency_key IS NOT NULL)
    DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL AND v_key IS NOT NULL THEN
    -- Only return a prior message owned by this sender in this conversation.
    SELECT m.* INTO v_row
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.author_user_id = auth.uid()
      AND m.kind = 'user'
      AND m.client_idempotency_key = v_key;
  END IF;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Message send failed' USING ERRCODE = '23505';
  END IF;

  SELECT CASE
    WHEN c.type = 'direct' AND c.dm_user_low = auth.uid() THEN c.dm_user_high
    WHEN c.type = 'direct' AND c.dm_user_high = auth.uid() THEN c.dm_user_low
    ELSE NULL
  END INTO v_other
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  IF v_other IS NOT NULL THEN
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

-- Refresh column grants after dropping idempotency_key
REVOKE ALL ON TABLE public.messages FROM PUBLIC;
GRANT SELECT (
  id, conversation_id, league_id, kind, author_user_id, author_display_name,
  body, league_event_id, created_at, edited_at, deleted_at,
  client_idempotency_key, system_idempotency_key
) ON public.messages TO authenticated;

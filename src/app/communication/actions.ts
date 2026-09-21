"use server";

import { formatLeagueEvent } from "@/lib/communication/event-format";
import type {
  ActionResult,
  DmThreadSummary,
  LeagueEventRow,
  LeagueMemberOption,
  MessageRow,
  NotificationRow,
  UnreadBadge,
} from "@/lib/communication/types";
import { computeBadge, countsTowardAlertBadge } from "@/lib/communication/unread";
import { loadLeagueContext } from "@/lib/league/context";
import { createClient } from "@/lib/supabase/server";

async function requireLeagueAuth() {
  const result = await loadLeagueContext();
  if (!result.ok) {
    return { ok: false as const, error: result.message };
  }
  const supabase = await createClient();
  return {
    ok: true as const,
    context: result.context,
    supabase,
    leagueId: result.context.league.id,
    userId: result.context.userId,
  };
}

export type DisplayMessage = MessageRow & {
  formattedBody: string;
  event: LeagueEventRow | null;
};

async function loadTeamLookup(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teamIds: string[],
) {
  const unique = [...new Set(teamIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data } = await supabase
    .from("teams")
    .select("id, abbreviation, name")
    .in("id", unique);
  for (const team of data ?? []) {
    map.set(team.id, team.name);
    map.set(team.abbreviation, team.name);
  }
  return map;
}

function collectTeamIdsFromEvents(events: LeagueEventRow[]): string[] {
  const ids: string[] = [];
  for (const event of events) {
    if (!event.is_revealed) continue;
    const payload = event.payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const teamId = payload.team_id;
      const previous = payload.previous_team_id;
      if (typeof teamId === "string") ids.push(teamId);
      if (typeof previous === "string") ids.push(previous);
    }
  }
  return ids;
}

async function hydrateMessages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  messages: MessageRow[],
): Promise<DisplayMessage[]> {
  const eventIds = [
    ...new Set(
      messages
        .map((m) => m.league_event_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  let events: LeagueEventRow[] = [];
  if (eventIds.length > 0) {
    const { data } = await supabase
      .from("league_events")
      .select(
        "id, league_id, season_id, week_id, event_type, actor_user_id, affected_user_id, actor_display_name, affected_display_name, domain_table, domain_record_id, payload, is_revealed, created_at, idempotency_key",
      )
      .in("id", eventIds);
    events = (data ?? []) as LeagueEventRow[];
  }
  const eventById = new Map(events.map((e) => [e.id, e]));
  const teams = await loadTeamLookup(
    supabase,
    collectTeamIdsFromEvents(events),
  );

  return messages.map((message) => {
    const event = message.league_event_id
      ? (eventById.get(message.league_event_id) ?? null)
      : null;
    let formattedBody: string;
    if (message.deleted_at) {
      formattedBody = "Message deleted";
    } else if (message.kind === "system" && event) {
      formattedBody = formatLeagueEvent(event, teams);
    } else {
      formattedBody = message.body ?? "";
    }
    return { ...message, formattedBody, event };
  });
}

export async function ensureLeagueConversationAction(): Promise<
  ActionResult<{ conversationId: string }>
> {
  const auth = await requireLeagueAuth();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data, error } = await auth.supabase.rpc("ensure_league_conversation", {
    p_league_id: auth.leagueId,
  });
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not open league chat." };
  }
  return { ok: true, data: { conversationId: data } };
}

export async function ensureDirectConversationAction(
  otherUserId: string,
): Promise<ActionResult<{ conversationId: string }>> {
  const auth = await requireLeagueAuth();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!otherUserId || otherUserId === auth.userId) {
    return { ok: false, error: "Choose another league member." };
  }

  const { data, error } = await auth.supabase.rpc("ensure_direct_conversation", {
    p_league_id: auth.leagueId,
    p_other_user_id: otherUserId,
  });
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not open DM." };
  }
  return { ok: true, data: { conversationId: data } };
}

export async function loadConversationMessagesAction(
  conversationId: string,
  limit = 80,
): Promise<ActionResult<{ messages: DisplayMessage[] }>> {
  const auth = await requireLeagueAuth();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data, error } = await auth.supabase
    .from("messages")
    .select(
      "id, conversation_id, league_id, kind, author_user_id, author_display_name, body, league_event_id, created_at, edited_at, deleted_at, client_idempotency_key, system_idempotency_key",
    )
    .eq("conversation_id", conversationId)
    .eq("league_id", auth.leagueId)
    .order("created_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 200));

  if (error) {
    return { ok: false, error: "Could not load messages." };
  }

  const messages = await hydrateMessages(
    auth.supabase,
    (data ?? []) as MessageRow[],
  );
  return { ok: true, data: { messages } };
}

export async function sendMessageAction(
  conversationId: string,
  body: string,
  idempotencyKey?: string | null,
): Promise<ActionResult<{ message: DisplayMessage }>> {
  const auth = await requireLeagueAuth();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data, error } = await auth.supabase.rpc("send_conversation_message", {
    p_conversation_id: conversationId,
    p_body: body,
    p_idempotency_key: idempotencyKey ?? null,
  });
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not send message." };
  }
  const [message] = await hydrateMessages(auth.supabase, [data as MessageRow]);
  return { ok: true, data: { message: message! } };
}

export async function editMessageAction(
  messageId: string,
  body: string,
): Promise<ActionResult<{ message: DisplayMessage }>> {
  const auth = await requireLeagueAuth();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data, error } = await auth.supabase.rpc("edit_own_message", {
    p_message_id: messageId,
    p_body: body,
  });
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not edit message." };
  }
  const [message] = await hydrateMessages(auth.supabase, [data as MessageRow]);
  return { ok: true, data: { message: message! } };
}

export async function deleteMessageAction(
  messageId: string,
): Promise<ActionResult<{ message: DisplayMessage }>> {
  const auth = await requireLeagueAuth();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data, error } = await auth.supabase.rpc("soft_delete_own_message", {
    p_message_id: messageId,
  });
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not delete message." };
  }
  const [message] = await hydrateMessages(auth.supabase, [data as MessageRow]);
  return { ok: true, data: { message: message! } };
}

export async function markConversationReadAction(
  conversationId: string,
  messageId?: string | null,
): Promise<ActionResult> {
  const auth = await requireLeagueAuth();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { error } = await auth.supabase.rpc("mark_conversation_read", {
    p_conversation_id: conversationId,
    p_message_id: messageId ?? null,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, data: undefined };
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<ActionResult> {
  const auth = await requireLeagueAuth();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { error } = await auth.supabase.rpc("mark_notification_read", {
    p_notification_id: notificationId,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, data: undefined };
}

export async function markAllNotificationsReadAction(): Promise<
  ActionResult<{ count: number }>
> {
  const auth = await requireLeagueAuth();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data, error } = await auth.supabase.rpc(
    "mark_all_notifications_read",
    { p_league_id: auth.leagueId },
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, data: { count: data ?? 0 } };
}

export async function loadLeagueMembersAction(): Promise<
  ActionResult<{ members: LeagueMemberOption[] }>
> {
  const auth = await requireLeagueAuth();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data: memberships, error } = await auth.supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", auth.leagueId)
    .eq("active", true);
  if (error) {
    return { ok: false, error: "Could not load members." };
  }
  const userIds = (memberships ?? [])
    .map((m) => m.user_id)
    .filter((id) => id !== auth.userId);
  if (userIds.length === 0) {
    return { ok: true, data: { members: [] } };
  }
  const { data: profiles, error: profileError } = await auth.supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  if (profileError) {
    return { ok: false, error: "Could not load member names." };
  }
  const members = (profiles ?? [])
    .map((p) => ({
      userId: p.id,
      displayName: p.display_name?.trim() || "Member",
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { ok: true, data: { members } };
}

export async function loadDmThreadsAction(): Promise<
  ActionResult<{ threads: DmThreadSummary[] }>
> {
  const auth = await requireLeagueAuth();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data: conversations, error } = await auth.supabase
    .from("conversations")
    .select("id, dm_user_low, dm_user_high, created_at")
    .eq("league_id", auth.leagueId)
    .eq("type", "direct");
  if (error) {
    return { ok: false, error: "Could not load DMs." };
  }

  const rows = conversations ?? [];
  if (rows.length === 0) {
    return { ok: true, data: { threads: [] } };
  }

  const otherIds = rows.map((c) =>
    c.dm_user_low === auth.userId ? c.dm_user_high! : c.dm_user_low!,
  );
  const conversationIds = rows.map((c) => c.id);

  const [profilesResult, readStatesResult, messagesResult] = await Promise.all([
    auth.supabase.from("profiles").select("id, display_name").in("id", otherIds),
    auth.supabase
      .from("conversation_read_states")
      .select("conversation_id, last_read_at")
      .eq("user_id", auth.userId)
      .in("conversation_id", conversationIds),
    auth.supabase
      .from("messages")
      .select(
        "id, conversation_id, body, kind, deleted_at, created_at, author_user_id",
      )
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false }),
  ]);

  if (profilesResult.error || readStatesResult.error || messagesResult.error) {
    return { ok: false, error: "Could not load DM details." };
  }

  const nameById = new Map(
    (profilesResult.data ?? []).map((p) => [
      p.id,
      p.display_name?.trim() || "Member",
    ]),
  );
  const readByConv = new Map(
    (readStatesResult.data ?? []).map((r) => [r.conversation_id, r.last_read_at]),
  );

  const latestByConv = new Map<
    string,
    {
      body: string | null;
      deleted_at: string | null;
      kind: string;
      created_at: string;
    }
  >();
  const unreadByConv = new Map<string, number>();

  for (const message of messagesResult.data ?? []) {
    if (!latestByConv.has(message.conversation_id)) {
      latestByConv.set(message.conversation_id, message);
    }
    const lastRead = readByConv.get(message.conversation_id) ?? "1970-01-01";
    if (
      message.created_at > lastRead &&
      message.author_user_id !== auth.userId &&
      !message.deleted_at
    ) {
      unreadByConv.set(
        message.conversation_id,
        (unreadByConv.get(message.conversation_id) ?? 0) + 1,
      );
    }
  }

  const threads: DmThreadSummary[] = rows
    .map((c) => {
      const otherUserId =
        c.dm_user_low === auth.userId ? c.dm_user_high! : c.dm_user_low!;
      const latest = latestByConv.get(c.id);
      let preview: string | null = null;
      if (latest) {
        if (latest.deleted_at) preview = "Message deleted";
        else if (latest.kind === "system") preview = "Activity";
        else preview = latest.body;
      }
      return {
        conversationId: c.id,
        otherUserId,
        otherDisplayName: nameById.get(otherUserId) ?? "Member",
        lastMessagePreview: preview,
        lastMessageAt: latest?.created_at ?? c.created_at,
        unreadCount: unreadByConv.get(c.id) ?? 0,
      };
    })
    .sort((a, b) =>
      (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
    );

  return { ok: true, data: { threads } };
}

export async function loadNotificationsAction(
  limit = 50,
): Promise<ActionResult<{ notifications: NotificationRow[] }>> {
  const auth = await requireLeagueAuth();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data, error } = await auth.supabase
    .from("notifications")
    .select(
      "id, recipient_user_id, league_id, notification_type, title, body, payload, link_path, created_at, read_at, idempotency_key",
    )
    .eq("league_id", auth.leagueId)
    .eq("recipient_user_id", auth.userId)
    .neq("notification_type", "direct_message")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  if (error) {
    return { ok: false, error: "Could not load alerts." };
  }
  return { ok: true, data: { notifications: (data ?? []) as NotificationRow[] } };
}

export async function loadUnreadBadgeAction(): Promise<
  ActionResult<UnreadBadge & { leagueConversationId: string | null }>
> {
  const auth = await requireLeagueAuth();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data: leagueConversationId, error: ensureError } =
    await auth.supabase.rpc("ensure_league_conversation", {
      p_league_id: auth.leagueId,
    });
  if (ensureError) {
    return { ok: false, error: "Could not load unread state." };
  }

  const { data: dmConversations } = await auth.supabase
    .from("conversations")
    .select("id")
    .eq("league_id", auth.leagueId)
    .eq("type", "direct");

  const dmIds = (dmConversations ?? []).map((c) => c.id);
  const conversationIds = [
    ...(leagueConversationId ? [leagueConversationId] : []),
    ...dmIds,
  ];

  const { data: readStates } = conversationIds.length
    ? await auth.supabase
        .from("conversation_read_states")
        .select("conversation_id, last_read_at")
        .eq("user_id", auth.userId)
        .in("conversation_id", conversationIds)
    : { data: [] as { conversation_id: string; last_read_at: string }[] };

  const readByConv = new Map(
    (readStates ?? []).map((r) => [r.conversation_id, r.last_read_at]),
  );

  let leagueUnread = false;
  if (leagueConversationId) {
    const lastRead = readByConv.get(leagueConversationId) ?? "1970-01-01";
    const { count } = await auth.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", leagueConversationId)
      .gt("created_at", lastRead)
      .or(`author_user_id.is.null,author_user_id.neq.${auth.userId}`);
    leagueUnread = (count ?? 0) > 0;
  }

  let dmUnreadCount = 0;
  for (const dmId of dmIds) {
    const lastRead = readByConv.get(dmId) ?? "1970-01-01";
    const { count } = await auth.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", dmId)
      .gt("created_at", lastRead)
      .neq("author_user_id", auth.userId);
    if ((count ?? 0) > 0) dmUnreadCount += 1;
  }

  const { data: alerts } = await auth.supabase
    .from("notifications")
    .select("notification_type")
    .eq("league_id", auth.leagueId)
    .eq("recipient_user_id", auth.userId)
    .is("read_at", null);

  const alertUnreadCount = (alerts ?? []).filter((n) =>
    countsTowardAlertBadge(n.notification_type),
  ).length;

  const badge = computeBadge({
    leagueUnread,
    dmUnreadCount,
    alertUnreadCount,
  });

  return {
    ok: true,
    data: {
      ...badge,
      leagueConversationId: leagueConversationId ?? null,
    },
  };
}

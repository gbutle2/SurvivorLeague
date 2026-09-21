import type { Json } from "@/lib/database.types";

export type ConversationType = "league" | "direct";
export type MessageKind = "user" | "system";

export type LeagueEventType =
  | "pick_submitted"
  | "pick_updated"
  | "commissioner_pick_changed"
  | "week_opened"
  | "week_locked"
  | "picks_revealed"
  | "result_entered"
  | "result_corrected"
  | "survivor_eliminated"
  | "season_activated"
  | "season_deactivated"
  | "member_added"
  | "member_removed"
  | "commissioner_announcement";

export type NotificationType =
  | "direct_message"
  | "commissioner_pick_changed"
  | "week_opened"
  | "week_locked"
  | "commissioner_announcement"
  | "survivor_eliminated";

/** Maps team id or abbreviation → nickname (e.g. "Bills"). */
export type TeamLookup = Map<string, string>;

export type CommTab = "league" | "dms" | "alerts";

export const COMM_TAB_STORAGE_KEY = "ssp-comm-tab";

export type LeagueEventForFormat = {
  event_type: LeagueEventType;
  actor_display_name: string | null;
  affected_display_name: string | null;
  is_revealed: boolean;
  payload: Json;
};

export type ConversationRow = {
  id: string;
  league_id: string;
  type: ConversationType;
  dm_user_low: string | null;
  dm_user_high: string | null;
  created_at: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  league_id: string;
  kind: MessageKind;
  author_user_id: string | null;
  author_display_name: string | null;
  body: string | null;
  league_event_id: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  client_idempotency_key: string | null;
  system_idempotency_key: string | null;
};

export type LeagueEventRow = {
  id: string;
  league_id: string;
  season_id: string | null;
  week_id: string | null;
  event_type: LeagueEventType;
  actor_user_id: string | null;
  affected_user_id: string | null;
  actor_display_name: string | null;
  affected_display_name: string | null;
  domain_table: string | null;
  domain_record_id: string | null;
  payload: Json;
  is_revealed: boolean;
  created_at: string;
  idempotency_key: string;
};

export type NotificationRow = {
  id: string;
  recipient_user_id: string;
  league_id: string;
  notification_type: NotificationType;
  title: string;
  body: string;
  payload: Json;
  link_path: string | null;
  created_at: string;
  read_at: string | null;
  idempotency_key: string;
};

export type ConversationReadStateRow = {
  conversation_id: string;
  user_id: string;
  last_read_at: string;
  last_read_message_id: string | null;
  updated_at: string;
};

export type LeagueMemberOption = {
  userId: string;
  displayName: string;
};

export type DmThreadSummary = {
  conversationId: string;
  otherUserId: string;
  otherDisplayName: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
};

export type UnreadBadgeInput = {
  leagueUnread: boolean;
  /** Unread DM conversations (or messages aggregated to conversation count). */
  dmUnreadCount: number;
  /**
   * Unread alerts excluding `direct_message`.
   * DM notifications are counted only via `dmUnreadCount` to avoid double-counting.
   */
  alertUnreadCount: number;
};

export type UnreadBadge = {
  redDot: boolean;
  numericBadge: number;
};

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

import type { UnreadBadge, UnreadBadgeInput } from "@/lib/communication/types";

/**
 * Combined communication badge.
 *
 * - `redDot` is driven only by unread league chat activity.
 * - `numericBadge` is DM conversation unreads + non-DM alert unreads.
 * - Callers must pass `alertUnreadCount` excluding `direct_message`
 *   notifications so DMs are not double-counted.
 */
export function computeBadge(input: UnreadBadgeInput): UnreadBadge {
  const dm = Math.max(0, Math.floor(input.dmUnreadCount));
  const alerts = Math.max(0, Math.floor(input.alertUnreadCount));
  return {
    redDot: Boolean(input.leagueUnread),
    numericBadge: dm + alerts,
  };
}

/** True when a notification type should contribute to the numeric alert count. */
export function countsTowardAlertBadge(
  notificationType: string,
): boolean {
  return notificationType !== "direct_message";
}

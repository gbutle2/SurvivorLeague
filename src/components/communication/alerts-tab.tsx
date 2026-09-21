"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import {
  loadNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/communication/actions";
import type { NotificationRow } from "@/lib/communication/types";
import { createClient } from "@/lib/supabase/client";

type AlertsTabProps = {
  leagueId: string;
  userId: string;
  active: boolean;
  onCloseOverlay: () => void;
  onUnreadChange?: () => void;
};

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function AlertsTab({
  leagueId,
  userId,
  active,
  onCloseOverlay,
  onUnreadChange,
}: AlertsTabProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await loadNotificationsAction();
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setNotifications(result.data.notifications);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!active) return;
    const handle = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [active, refresh]);

  useEffect(() => {
    if (!active) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`alerts:${leagueId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          void refresh();
          onUnreadChange?.();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [active, leagueId, onUnreadChange, refresh, userId]);

  function markOne(id: string) {
    startTransition(async () => {
      await markNotificationReadAction(id);
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n,
        ),
      );
      onUnreadChange?.();
    });
  }

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      setNotifications((prev) =>
        prev.map((n) => ({
          ...n,
          read_at: n.read_at ?? new Date().toISOString(),
        })),
      );
      onUnreadChange?.();
    });
  }

  function openAlert(notification: NotificationRow) {
    if (!notification.read_at) {
      void markNotificationReadAction(notification.id).then(() => {
        onUnreadChange?.();
      });
    }
    if (notification.link_path) {
      onCloseOverlay();
      router.push(notification.link_path);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-stone-500">
        Loading alerts…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-red-700">
        <p>{error}</p>
        <button
          type="button"
          className="text-emerald-900 underline"
          onClick={() => void refresh()}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
        <p className="text-xs text-stone-500">
          Personal alerts (DMs counted separately)
        </p>
        <button
          type="button"
          disabled={pending || notifications.every((n) => n.read_at)}
          onClick={markAll}
          className="min-h-11 rounded-lg px-2 text-xs font-semibold text-emerald-900 underline-offset-2 hover:underline disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
        >
          Mark all read
        </button>
      </div>
      {notifications.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-stone-500">
          No alerts yet.
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto divide-y divide-stone-100">
          {notifications.map((notification) => {
            const unread = !notification.read_at;
            return (
              <li key={notification.id}>
                <div
                  className={`flex gap-2 px-3 py-3 ${
                    unread ? "bg-emerald-50/60" : "bg-white"
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                    onClick={() => openAlert(notification)}
                  >
                    <span className="block text-sm font-semibold text-stone-900">
                      {notification.title}
                    </span>
                    <span className="mt-0.5 block text-sm text-stone-600">
                      {notification.body}
                    </span>
                    <span className="mt-1 block text-[0.65rem] text-stone-400">
                      {formatTime(notification.created_at)}
                    </span>
                  </button>
                  {unread ? (
                    <button
                      type="button"
                      className="shrink-0 self-start rounded-lg px-2 py-1 text-xs font-medium text-emerald-900 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                      onClick={() => markOne(notification.id)}
                    >
                      Mark read
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

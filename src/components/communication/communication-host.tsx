"use client";

import { useCallback, useEffect, useState } from "react";

import { loadUnreadBadgeAction } from "@/app/communication/actions";
import { CommunicationOverlay } from "@/components/communication/communication-overlay";
import {
  COMM_TAB_STORAGE_KEY,
  type CommTab,
} from "@/lib/communication/types";
import { createClient } from "@/lib/supabase/client";

type CommunicationHostProps = {
  leagueId: string;
  userId: string;
};

function readStoredTab(): CommTab {
  if (typeof window === "undefined") return "league";
  try {
    const value = sessionStorage.getItem(COMM_TAB_STORAGE_KEY);
    if (value === "league" || value === "dms" || value === "alerts") {
      return value;
    }
  } catch {
    /* ignore */
  }
  return "league";
}

export function CommunicationHost({ leagueId, userId }: CommunicationHostProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<CommTab>("league");
  const [redDot, setRedDot] = useState(false);
  const [numericBadge, setNumericBadge] = useState(0);
  const [leagueConversationId, setLeagueConversationId] = useState<
    string | null
  >(null);

  const refreshBadge = useCallback(async () => {
    const result = await loadUnreadBadgeAction();
    if (!result.ok) return;
    setRedDot(result.data.redDot);
    setNumericBadge(result.data.numericBadge);
    setLeagueConversationId(result.data.leagueConversationId);
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setTab(readStoredTab());
      void refreshBadge();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [refreshBadge]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`comm-badge:${leagueId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          void refreshBadge();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          void refreshBadge();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [leagueId, refreshBadge, userId]);

  function handleTabChange(next: CommTab) {
    setTab(next);
    try {
      sessionStorage.setItem(COMM_TAB_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const badgeLabel =
    numericBadge > 0
      ? `${numericBadge} unread direct messages or alerts`
      : redDot
        ? "Unread league activity"
        : "No unread messages";

  return (
    <>
      <div className="pointer-events-none fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-40 sm:bottom-8 sm:right-6">
        <button
          type="button"
          className="pointer-events-auto relative inline-flex min-h-12 min-w-12 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-800 shadow-md transition hover:border-emerald-700/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
          aria-label={`Open messages. ${badgeLabel}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <SpeechBubbleIcon />
          {redDot ? (
            <span
              className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-600 ring-2 ring-white"
              aria-hidden
            />
          ) : null}
          {numericBadge > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-800 px-1 text-[0.65rem] font-bold text-white">
              {numericBadge > 99 ? "99+" : numericBadge}
            </span>
          ) : null}
        </button>
      </div>

      <CommunicationOverlay
        open={open}
        onClose={() => setOpen(false)}
        tab={tab}
        onTabChange={handleTabChange}
        leagueId={leagueId}
        userId={userId}
        leagueConversationId={leagueConversationId}
        onUnreadChange={refreshBadge}
      />
    </>
  );
}

function SpeechBubbleIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.2 3.15A.75.75 0 0 1 4.5 18.5V16h0A2.5 2.5 0 0 1 4 13.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M8 9h8M8 12h5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

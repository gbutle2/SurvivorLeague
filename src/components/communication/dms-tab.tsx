"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import {
  ensureDirectConversationAction,
  loadConversationMessagesAction,
  loadDmThreadsAction,
  loadLeagueMembersAction,
  markConversationReadAction,
  sendMessageAction,
  type DisplayMessage,
} from "@/app/communication/actions";
import { Composer } from "@/components/communication/composer";
import { MessageList } from "@/components/communication/message-list";
import type {
  DmThreadSummary,
  LeagueMemberOption,
} from "@/lib/communication/types";
import { createClient } from "@/lib/supabase/client";

type DmsTabProps = {
  leagueId: string;
  userId: string;
  active: boolean;
  onUnreadChange?: () => void;
};

export function DmsTab({
  leagueId,
  userId,
  active,
  onUnreadChange,
}: DmsTabProps) {
  const [threads, setThreads] = useState<DmThreadSummary[]>([]);
  const [members, setMembers] = useState<LeagueMemberOption[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [activeOtherName, setActiveOtherName] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, startSend] = useTransition();

  const refreshList = useCallback(async () => {
    setLoading(true);
    const [threadsResult, membersResult] = await Promise.all([
      loadDmThreadsAction(),
      loadLeagueMembersAction(),
    ]);
    if (!threadsResult.ok) {
      setError(threadsResult.error);
      setLoading(false);
      return;
    }
    if (!membersResult.ok) {
      setError(membersResult.error);
      setLoading(false);
      return;
    }
    setThreads(threadsResult.data.threads);
    setMembers(membersResult.data.members);
    setError(null);
    setLoading(false);
  }, []);

  const openConversation = useCallback(
    async (conversationId: string, otherName: string) => {
      setActiveConversationId(conversationId);
      setActiveOtherName(otherName);
      const result = await loadConversationMessagesAction(conversationId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessages(result.data.messages);
      const last = result.data.messages[result.data.messages.length - 1];
      await markConversationReadAction(conversationId, last?.id);
      onUnreadChange?.();
    },
    [onUnreadChange],
  );

  useEffect(() => {
    if (!active) return;
    const handle = window.setTimeout(() => {
      void refreshList();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [active, refreshList]);

  useEffect(() => {
    if (!active) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`dm-messages:${leagueId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          if (activeConversationId) {
            void openConversation(
              activeConversationId,
              activeOtherName ?? "Member",
            );
          } else {
            void refreshList();
          }
          onUnreadChange?.();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [
    active,
    activeConversationId,
    activeOtherName,
    leagueId,
    onUnreadChange,
    openConversation,
    refreshList,
    userId,
  ]);

  async function startDm(member: LeagueMemberOption) {
    const result = await ensureDirectConversationAction(member.userId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await openConversation(result.data.conversationId, member.displayName);
    await refreshList();
  }

  function handleSend(body: string) {
    if (!activeConversationId) return;
    startSend(async () => {
      const result = await sendMessageAction(
        activeConversationId,
        body,
        crypto.randomUUID(),
      );
      if (!result.ok) throw new Error(result.error);
      setMessages((prev) =>
        prev.some((m) => m.id === result.data.message.id)
          ? prev
          : [...prev, result.data.message],
      );
    });
  }

  if (loading && !activeConversationId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-stone-500">
        Loading DMs…
      </div>
    );
  }

  if (activeConversationId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-stone-200 px-3 py-2">
          <button
            type="button"
            className="min-h-11 rounded-lg px-2 text-sm font-medium text-emerald-900 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
            onClick={() => {
              setActiveConversationId(null);
              setActiveOtherName(null);
              setMessages([]);
              void refreshList();
            }}
          >
            ← Back
          </button>
          <p className="truncate text-sm font-semibold text-stone-900">
            {activeOtherName}
          </p>
        </div>
        {error ? (
          <p className="px-3 py-2 text-xs text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        <MessageList
          messages={messages}
          currentUserId={userId}
          emptyLabel="No messages yet. Say hello."
        />
        <Composer sending={sending} onSend={handleSend} />
      </div>
    );
  }

  const memberIdsInThreads = new Set(threads.map((t) => t.otherUserId));
  const startable = members.filter((m) => !memberIdsInThreads.has(m.userId));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {error ? (
        <p className="px-3 py-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <section className="px-3 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Conversations
        </h3>
        {threads.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">No direct messages yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-stone-100">
            {threads.map((thread) => (
              <li key={thread.conversationId}>
                <button
                  type="button"
                  className="flex w-full min-h-11 items-start justify-between gap-2 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                  onClick={() =>
                    void openConversation(
                      thread.conversationId,
                      thread.otherDisplayName,
                    )
                  }
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-stone-900">
                      {thread.otherDisplayName}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-stone-500">
                      {thread.lastMessagePreview ?? "No messages"}
                    </span>
                  </span>
                  {thread.unreadCount > 0 ? (
                    <span className="shrink-0 rounded-full bg-emerald-800 px-2 py-0.5 text-xs font-semibold text-white">
                      {thread.unreadCount}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {startable.length > 0 ? (
        <section className="border-t border-stone-100 px-3 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Start a DM
          </h3>
          <ul className="mt-2">
            {startable.map((member) => (
              <li key={member.userId}>
                <button
                  type="button"
                  className="flex w-full min-h-11 items-center py-2 text-left text-sm font-medium text-emerald-900 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                  onClick={() => void startDm(member)}
                >
                  {member.displayName}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

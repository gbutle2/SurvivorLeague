"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  ensureLeagueConversationAction,
  loadConversationMessagesAction,
  markConversationReadAction,
  sendMessageAction,
  type DisplayMessage,
} from "@/app/communication/actions";
import { Composer } from "@/components/communication/composer";
import { MessageList } from "@/components/communication/message-list";
import { createClient } from "@/lib/supabase/client";
import type { MessageRow } from "@/lib/communication/types";

type LeagueTabProps = {
  leagueId: string;
  userId: string;
  conversationId: string | null;
  active: boolean;
  onConversationId?: (conversationId: string) => void;
  onUnreadChange?: () => void;
};

export function LeagueTab({
  leagueId,
  userId,
  conversationId,
  active,
  onConversationId,
  onUnreadChange,
}: LeagueTabProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, startSend] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const resolvedConversationId = conversationId;

  const mergeMessage = useCallback((incoming: DisplayMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === incoming.id)) {
        return prev.map((m) => (m.id === incoming.id ? incoming : m));
      }
      return [...prev, incoming];
    });
  }, []);

  const markRead = useCallback(
    async (targetConversationId: string, messageId?: string | null) => {
      const result = await markConversationReadAction(
        targetConversationId,
        messageId ?? null,
      );
      if (result.ok) {
        onUnreadChange?.();
      }
    },
    [onUnreadChange],
  );

  const refresh = useCallback(async () => {
    let activeConversationId = resolvedConversationId;
    if (!activeConversationId) {
      const ensured = await ensureLeagueConversationAction();
      if (!ensured.ok) {
        setLoading(false);
        setError(ensured.error);
        return;
      }
      activeConversationId = ensured.data.conversationId;
      onConversationId?.(activeConversationId);
    }

    setLoading(true);
    const result = await loadConversationMessagesAction(activeConversationId);
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setMessages(result.data.messages);
    setError(null);
    setLoading(false);

    const last = result.data.messages[result.data.messages.length - 1];
    await markRead(activeConversationId, last?.id ?? null);
  }, [markRead, onConversationId, resolvedConversationId]);

  useEffect(() => {
    if (!active) return;
    const handle = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [active, refresh]);

  // Mark read as soon as the league tab is visible, even before messages load,
  // so the badge clears immediately when the user opens chat.
  useEffect(() => {
    if (!active || !resolvedConversationId) return;
    const handle = window.setTimeout(() => {
      void markRead(resolvedConversationId, null);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [active, markRead, resolvedConversationId]);

  useEffect(() => {
    if (!active || !resolvedConversationId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`league-messages:${resolvedConversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as MessageRow | undefined;
          if (!row || row.conversation_id !== resolvedConversationId) return;
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [active, resolvedConversationId, leagueId, refresh]);

  useEffect(() => {
    if (!stickToBottom.current || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function handleSend(body: string) {
    if (!resolvedConversationId) return;
    startSend(async () => {
      const result = await sendMessageAction(
        resolvedConversationId,
        body,
        crypto.randomUUID(),
      );
      if (!result.ok) {
        throw new Error(result.error);
      }
      mergeMessage(result.data.message);
      stickToBottom.current = true;
      await markRead(resolvedConversationId, result.data.message.id);
    });
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-stone-500">
        Loading league chat…
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
    <div className="flex min-h-0 flex-1 flex-col" onScrollCapture={onScroll}>
      <MessageList
        messages={messages}
        currentUserId={userId}
        emptyLabel="No league messages yet. Say hello or wait for activity."
        listRef={listRef}
      />
      <Composer sending={sending} onSend={handleSend} />
    </div>
  );
}

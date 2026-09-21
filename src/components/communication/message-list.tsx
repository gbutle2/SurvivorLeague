"use client";

import type { RefObject } from "react";

import type { DisplayMessage } from "@/app/communication/actions";

type MessageListProps = {
  messages: DisplayMessage[];
  currentUserId: string;
  emptyLabel?: string;
  listRef?: RefObject<HTMLDivElement | null>;
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

export function MessageList({
  messages,
  currentUserId,
  emptyLabel = "No messages yet.",
  listRef,
}: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-sm text-stone-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {messages.map((message) => {
        if (message.kind === "system") {
          return (
            <div
              key={message.id}
              className="mx-auto max-w-[92%] rounded-md bg-stone-100 px-3 py-2 text-center text-xs leading-relaxed text-stone-600"
            >
              <p>{message.formattedBody}</p>
              <p className="mt-1 text-[0.65rem] text-stone-400">
                {formatTime(message.created_at)}
              </p>
            </div>
          );
        }

        const mine = message.author_user_id === currentUserId;
        const deleted = Boolean(message.deleted_at);

        return (
          <div
            key={message.id}
            className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
          >
            {!mine ? (
              <p className="mb-0.5 px-1 text-xs font-medium text-stone-600">
                {message.author_display_name ?? "Member"}
              </p>
            ) : null}
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                deleted
                  ? "bg-stone-100 italic text-stone-500"
                  : mine
                    ? "bg-emerald-800 text-white"
                    : "bg-white text-stone-900 ring-1 ring-stone-200"
              }`}
            >
              <p>{message.formattedBody}</p>
              <p
                className={`mt-1 text-[0.65rem] ${
                  mine && !deleted ? "text-emerald-100/80" : "text-stone-400"
                }`}
              >
                {formatTime(message.created_at)}
                {message.edited_at && !deleted ? " · edited" : null}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

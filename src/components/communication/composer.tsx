"use client";

import { useState, type FormEvent } from "react";

type ComposerProps = {
  disabled?: boolean;
  sending?: boolean;
  onSend: (body: string) => Promise<void> | void;
  placeholder?: string;
};

export function Composer({
  disabled = false,
  sending = false,
  onSend,
  placeholder = "Write a message…",
}: ComposerProps) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || disabled || sending) return;
    setError(null);
    try {
      await onSend(trimmed);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send.");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-stone-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
    >
      {error ? (
        <p className="mb-1 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <label className="sr-only" htmlFor="comm-composer">
          Message
        </label>
        <textarea
          id="comm-composer"
          rows={1}
          maxLength={2000}
          value={body}
          disabled={disabled || sending}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit(e);
            }
          }}
          placeholder={placeholder}
          className="min-h-11 flex-1 resize-none rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || sending || !body.trim()}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-emerald-800 px-3 text-sm font-semibold text-white transition hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </form>
  );
}

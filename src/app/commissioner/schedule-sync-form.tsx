"use client";

import { useActionState } from "react";

import {
  syncNflScheduleAction,
  type WeekActionState,
} from "@/app/commissioner/actions";

const initial: WeekActionState = { error: null, success: null };

export function SyncNflScheduleForm({ seasonYear }: { seasonYear: number }) {
  const [state, action, pending] = useActionState(syncNflScheduleAction, initial);

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
      <h2 className="text-base font-semibold text-stone-900">
        Sync NFL schedule / results
      </h2>
      <p className="text-sm text-stone-600">
        Pulls the fixed nflverse schedules release for {seasonYear}, upserts
        games, ensures weeks 1–18 and playoff rounds, and applies automatic
        pending-pick results for final games. Kickoffs update before the stored
        kickoff; post-kickoff changes need review. Scores refresh daily plus this
        manual sync — not live scoring. Cancellations/no-contests may need
        commissioner action.
      </p>
      {state.error ? (
        <p className="text-sm text-rose-800" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="text-sm text-emerald-800" role="status">
          {state.success}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-800 px-4 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Syncing…" : "Sync NFL data"}
      </button>
    </form>
  );
}

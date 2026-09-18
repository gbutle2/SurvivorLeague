"use client";

import { useActionState, useState } from "react";

import {
  changePasswordAction,
  type ChangePasswordState,
} from "@/app/change-password/actions";

const initial: ChangePasswordState = { error: null };

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initial);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <form action={action} className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="new_password"
          className="text-sm font-medium text-stone-700"
        >
          New password
        </label>
        <div className="flex gap-2">
          <input
            id="new_password"
            name="new_password"
            type={showNew ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={12}
            className="h-11 min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/30"
          />
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-stone-300 px-3 text-sm font-semibold text-stone-800"
            onClick={() => setShowNew((value) => !value)}
          >
            {showNew ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="confirm_password"
          className="text-sm font-medium text-stone-700"
        >
          Confirm password
        </label>
        <div className="flex gap-2">
          <input
            id="confirm_password"
            name="confirm_password"
            type={showConfirm ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={12}
            className="h-11 min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/30"
          />
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-stone-300 px-3 text-sm font-semibold text-stone-800"
            onClick={() => setShowConfirm((value) => !value)}
          >
            {showConfirm ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}

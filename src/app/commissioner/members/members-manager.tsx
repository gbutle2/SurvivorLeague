"use client";

import { useActionState, useState } from "react";

import {
  createPlayerAction,
  deactivateMemberAction,
  dismissTempPasswordAction,
  reactivateMemberAction,
  resetPasswordAction,
  type MembersActionState,
} from "@/app/commissioner/members/actions";
import type { MemberListItem } from "@/lib/members/manage";

const initial: MembersActionState = {
  error: null,
  success: null,
  temporaryPassword: null,
  createdEmail: null,
  createdDisplayName: null,
};

type MembersManagerProps = {
  members: MemberListItem[];
  activeCount: number;
};

export function MembersManager({
  members,
  activeCount,
}: MembersManagerProps) {
  const [createState, createAction, createPending] = useActionState(
    createPlayerAction,
    initial,
  );
  const [resetState, resetAction, resetPending] = useActionState(
    resetPasswordAction,
    initial,
  );
  const [deactivateState, deactivateAction, deactivatePending] = useActionState(
    deactivateMemberAction,
    initial,
  );
  const [reactivateState, reactivateAction, reactivatePending] = useActionState(
    reactivateMemberAction,
    initial,
  );
  const [, dismissAction] = useActionState(dismissTempPasswordAction, initial);

  const [dismissedPassword, setDismissedPassword] = useState<string | null>(
    null,
  );

  const latestPassword =
    createState.temporaryPassword || resetState.temporaryPassword || null;
  const visiblePassword =
    latestPassword && latestPassword !== dismissedPassword
      ? latestPassword
      : null;

  const flash = visiblePassword
    ? createState.temporaryPassword
      ? createState
      : resetState
    : createState.error || createState.success
      ? createState
      : resetState.error || resetState.success
        ? resetState
        : deactivateState.error || deactivateState.success
          ? deactivateState
          : reactivateState;

  async function copyPassword() {
    if (!visiblePassword) return;
    try {
      await navigator.clipboard.writeText(visiblePassword);
    } catch {
      // Selectable field remains available.
    }
  }

  return (
    <div className="space-y-6">
      {flash.error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900"
        >
          {flash.error}
        </p>
      ) : null}

      {flash.success && !visiblePassword ? (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-950"
        >
          {flash.success}
        </p>
      ) : null}

      {visiblePassword ? (
        <section
          aria-label="Temporary password"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4"
        >
          <p className="text-sm font-semibold text-amber-950">
            Temporary password — shown once
          </p>
          <p className="mt-1 text-sm text-amber-900">
            Copy and share this password out of band. It will not be shown again
            after you dismiss this panel.
          </p>
          {flash.createdEmail ? (
            <p className="mt-2 text-sm text-amber-900">
              Account: {flash.createdDisplayName ?? "Player"} (
              {flash.createdEmail})
            </p>
          ) : null}
          <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-amber-900">
            Password
            <input
              readOnly
              value={visiblePassword}
              className="mt-1 h-11 w-full select-all rounded-lg border border-amber-300 bg-white px-3 font-mono text-base text-stone-900"
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void copyPassword()}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-amber-900 px-4 text-sm font-semibold text-white"
            >
              Copy password
            </button>
            <form action={dismissAction} className="sm:ml-auto">
              <button
                type="submit"
                onClick={() => setDismissedPassword(visiblePassword)}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-amber-400 bg-white px-4 text-sm font-semibold text-amber-950 sm:w-auto"
              >
                Dismiss
              </button>
            </form>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-stone-900">Create player</h2>
        <p className="mt-1 text-sm text-stone-600">
          Active members: {activeCount}. New accounts receive a one-time
          temporary password.
        </p>
        <form action={createAction} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-stone-700">
            Display name
            <input
              name="display_name"
              required
              maxLength={40}
              className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/30"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-stone-700">
            Email
            <input
              name="email"
              type="email"
              required
              autoComplete="off"
              className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/30"
            />
          </label>
          <input type="hidden" name="league_id" value="ignore-me" />
          <input type="hidden" name="requester_id" value="ignore-me" />
          <input type="hidden" name="role" value="commissioner" />
          <button
            type="submit"
            disabled={createPending}
            className="mt-1 inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {createPending ? "Creating…" : "Create player"}
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-stone-900">League members</h2>
        <ul className="space-y-3">
          {members.map((member) => (
            <li
              key={member.userId}
              className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold text-stone-900">
                      {member.displayName}
                    </p>
                    <p className="break-all text-sm text-stone-600">
                      {member.email ?? "Email unavailable"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge
                      label={member.role}
                      tone={member.role === "commissioner" ? "emerald" : "stone"}
                    />
                    <StatusBadge
                      label={member.active ? "Active" : "Inactive"}
                      tone={member.active ? "emerald" : "amber"}
                    />
                    <StatusBadge
                      label={
                        member.passwordStatus === "temporary"
                          ? "Temporary password"
                          : "Password changed"
                      }
                      tone={
                        member.passwordStatus === "temporary" ? "amber" : "stone"
                      }
                    />
                  </div>
                </div>
                <p className="text-xs text-stone-500">
                  Joined {new Date(member.joinedAt).toLocaleDateString()}
                </p>

                {member.role === "player" ? (
                  <div className="mt-2 flex flex-col gap-2 border-t border-stone-100 pt-3">
                    {member.active ? (
                      <>
                        <form action={resetAction} className="flex flex-col gap-2">
                          <input type="hidden" name="user_id" value={member.userId} />
                          <input type="hidden" name="league_id" value="ignore" />
                          <label className="flex min-h-11 items-center gap-2 text-sm text-stone-700">
                            <input
                              type="checkbox"
                              name="confirm"
                              value="yes"
                              className="size-4"
                              required
                            />
                            Confirm password reset
                          </label>
                          <button
                            type="submit"
                            disabled={resetPending}
                            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-900"
                          >
                            {resetPending
                              ? "Resetting…"
                              : "Reset temporary password"}
                          </button>
                        </form>
                        <form
                          action={deactivateAction}
                          className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3"
                        >
                          <input type="hidden" name="user_id" value={member.userId} />
                          <label className="flex min-h-11 items-center gap-2 text-sm text-red-900">
                            <input
                              type="checkbox"
                              name="confirm"
                              value="yes"
                              className="size-4"
                              required
                            />
                            Confirm deactivation (keeps history)
                          </label>
                          <button
                            type="submit"
                            disabled={deactivatePending}
                            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-red-800 px-4 text-sm font-semibold text-white"
                          >
                            {deactivatePending ? "Deactivating…" : "Deactivate"}
                          </button>
                        </form>
                      </>
                    ) : (
                      <form action={reactivateAction}>
                        <input type="hidden" name="user_id" value={member.userId} />
                        <button
                          type="submit"
                          disabled={reactivatePending}
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          {reactivatePending ? "Reactivating…" : "Reactivate"}
                        </button>
                      </form>
                    )}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "emerald" | "amber" | "stone";
}) {
  const classes =
    tone === "emerald"
      ? "bg-emerald-100 text-emerald-900"
      : tone === "amber"
        ? "bg-amber-100 text-amber-950"
        : "bg-stone-100 text-stone-700";
  return (
    <span
      className={`inline-flex max-w-full rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${classes}`}
    >
      {label}
    </span>
  );
}

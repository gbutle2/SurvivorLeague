"use client";

import { useActionState, useState, type ReactNode } from "react";

import {
  activateSeason,
  createWeek,
  setWeekStatus,
  updateWeek,
  type WeekActionState,
} from "@/app/commissioner/actions";
import type { WeekStatus } from "@/lib/database.types";
import { toChicagoDateAndTimeInputs } from "@/lib/time/chicago";
import {
  canShowLockAction,
  canShowOpenAction,
  type WeekPresentation,
} from "@/lib/weeks/lifecycle";

const initialState: WeekActionState = { error: null, success: null };

type WeekCardModel = {
  id: string;
  week_number: number;
  label: string;
  locks_at: string;
  status: WeekStatus;
  locksAtLabel: string;
  editable: boolean;
  presentation: WeekPresentation;
};

export function ActivateSeasonForm({
  year,
  canActivate,
  blockedReason,
}: {
  year: number;
  canActivate: boolean;
  blockedReason: string | null;
}) {
  const [state, action, pending] = useActionState(activateSeason, initialState);
  const [confirm, setConfirm] = useState(false);

  return (
    <form
      action={action}
      className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm"
    >
      <h2 className="text-base font-semibold text-amber-950">
        Activate {year} season
      </h2>
      <p className="text-sm leading-relaxed text-amber-950">
        Activation moves the season from setup to active and enables player pick
        submission once a week is marked open. This cannot be undone from the
        app.
      </p>
      {!canActivate && blockedReason ? (
        <p className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-950">
          {blockedReason}
        </p>
      ) : null}
      <label className="flex min-h-11 items-start gap-3 text-sm text-amber-950">
        <input
          type="checkbox"
          name="confirm"
          value="yes"
          checked={confirm}
          onChange={(event) => setConfirm(event.target.checked)}
          className="mt-1 h-5 w-5"
          disabled={!canActivate || pending}
        />
        <span>I confirm activating the {year} season.</span>
      </label>
      <Feedback state={state} />
      <button
        type="submit"
        disabled={!canActivate || !confirm || pending}
        className={primaryButtonClass}
      >
        {pending ? "Activating…" : "Activate season"}
      </button>
    </form>
  );
}

export function CreateWeekForm() {
  const [state, action, pending] = useActionState(createWeek, initialState);

  return (
    <form
      action={action}
      className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-base font-semibold text-stone-900">Create week</h2>
      <p className="text-sm text-stone-600">
        New weeks start as <strong>upcoming</strong>. Enter the lock deadline in
        Central Time (America/Chicago). The deadline must be in the future.
      </p>

      <Field label="Week number (1–17)" htmlFor="create-week-number">
        <input
          id="create-week-number"
          name="week_number"
          type="number"
          min={1}
          max={17}
          required
          className={inputClass}
        />
      </Field>

      <Field label="Label" htmlFor="create-label">
        <input
          id="create-label"
          name="label"
          type="text"
          required
          placeholder="Week 1"
          className={inputClass}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lock date (Central Time)" htmlFor="create-lock-date">
          <input
            id="create-lock-date"
            name="lock_date"
            type="date"
            required
            className={inputClass}
          />
        </Field>
        <Field label="Lock time (Central Time)" htmlFor="create-lock-time">
          <input
            id="create-lock-time"
            name="lock_time"
            type="time"
            required
            className={inputClass}
          />
        </Field>
      </div>

      <Feedback state={state} />

      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Creating…" : "Create week"}
      </button>
    </form>
  );
}

export function WeekManagerCard({ week }: { week: WeekCardModel }) {
  const [editState, editAction, editPending] = useActionState(
    updateWeek,
    initialState,
  );
  const [statusState, statusAction, statusPending] = useActionState(
    setWeekStatus,
    initialState,
  );
  const [confirmLock, setConfirmLock] = useState(false);
  const chicago = toChicagoDateAndTimeInputs(week.locks_at);
  const showOpen = canShowOpenAction({
    status: week.status,
    locksAt: week.locks_at,
  });
  const showLock = canShowLockAction({
    status: week.status,
    locksAt: week.locks_at,
  });

  return (
    <article
      className={[
        "space-y-3 rounded-2xl border p-4 shadow-sm",
        week.presentation.tone === "active"
          ? "border-emerald-300 bg-emerald-50/40"
          : week.presentation.tone === "expired"
            ? "border-amber-300 bg-amber-50/50"
            : week.presentation.tone === "locked"
              ? "border-stone-300 bg-stone-50"
              : "border-stone-200 bg-white",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-stone-900">
            Week {week.week_number}
          </h3>
          <p className="text-sm text-stone-600">{week.label}</p>
        </div>
        <StatusBadge presentation={week.presentation} />
      </div>

      <p className="text-sm text-stone-700">
        <span className="font-medium">Locks:</span> {week.locksAtLabel}
      </p>

      {week.presentation.kind === "open_expired" ? (
        <p className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-950">
          The deadline has passed. Lock this week when you are ready; it cannot
          be reopened after locking.
        </p>
      ) : null}

      {week.editable ? (
        <form action={editAction} className="space-y-3 border-t border-stone-200/70 pt-3">
          <input type="hidden" name="week_id" value={week.id} />
          <Field label="Label" htmlFor={`label-${week.id}`}>
            <input
              id={`label-${week.id}`}
              name="label"
              type="text"
              required
              defaultValue={week.label}
              className={inputClass}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Lock date (Central Time)"
              htmlFor={`lock-date-${week.id}`}
            >
              <input
                id={`lock-date-${week.id}`}
                name="lock_date"
                type="date"
                required
                defaultValue={chicago.date}
                className={inputClass}
              />
            </Field>
            <Field
              label="Lock time (Central Time)"
              htmlFor={`lock-time-${week.id}`}
            >
              <input
                id={`lock-time-${week.id}`}
                name="lock_time"
                type="time"
                required
                defaultValue={chicago.time}
                className={inputClass}
              />
            </Field>
          </div>
          <Feedback state={editState} />
          <button
            type="submit"
            disabled={editPending}
            className={secondaryButtonClass}
          >
            {editPending ? "Saving…" : "Save label & deadline"}
          </button>
        </form>
      ) : week.status === "locked" || week.status === "final" ? (
        <p className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-600">
          This week is read-only.
        </p>
      ) : null}

      {(showOpen || showLock) && (
        <div className="flex flex-col gap-2 border-t border-stone-200/70 pt-3">
          {showOpen ? (
            <form action={statusAction}>
              <input type="hidden" name="week_id" value={week.id} />
              <input type="hidden" name="status" value="open" />
              <button
                type="submit"
                disabled={statusPending}
                className={primaryButtonClass}
              >
                {statusPending ? "Opening…" : "Mark open for picks"}
              </button>
            </form>
          ) : null}

          {showLock ? (
            <form action={statusAction} className="space-y-2">
              <input type="hidden" name="week_id" value={week.id} />
              <input type="hidden" name="status" value="locked" />
              <label className="flex min-h-11 items-start gap-3 text-sm text-stone-700">
                <input
                  type="checkbox"
                  name="confirm"
                  value="yes"
                  checked={confirmLock}
                  onChange={(event) => setConfirmLock(event.target.checked)}
                  className="mt-1 h-5 w-5"
                />
                <span>I confirm locking Week {week.week_number}.</span>
              </label>
              <button
                type="submit"
                disabled={statusPending || !confirmLock}
                className={dangerButtonClass}
              >
                {statusPending ? "Locking…" : "Close / lock week"}
              </button>
            </form>
          ) : null}

          <Feedback state={statusState} />
        </div>
      )}
    </article>
  );
}

function StatusBadge({ presentation }: { presentation: WeekPresentation }) {
  const styles: Record<WeekPresentation["tone"], string> = {
    neutral: "bg-stone-100 text-stone-700",
    active: "bg-emerald-100 text-emerald-900",
    expired: "bg-amber-100 text-amber-950",
    locked: "bg-slate-200 text-slate-800",
  };
  return (
    <span
      className={`rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide ${styles[presentation.tone]}`}
    >
      {presentation.label}
    </span>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-stone-700">
        {label}
      </label>
      {children}
    </div>
  );
}

function Feedback({ state }: { state: WeekActionState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
      >
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p
        role="status"
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
      >
        {state.success}
      </p>
    );
  }
  return null;
}

const inputClass =
  "min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none ring-emerald-700/30 focus:border-emerald-700 focus:ring-2";

const primaryButtonClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white transition enabled:active:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";

const secondaryButtonClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-emerald-800 bg-white px-4 text-sm font-semibold text-emerald-900 transition enabled:active:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";

const dangerButtonClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-red-800 px-4 text-sm font-semibold text-white transition enabled:active:bg-red-950 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800";

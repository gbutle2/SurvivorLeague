"use client";

import { useActionState, useState, type ReactNode } from "react";

import {
  createWeek,
  setWeekStatus,
  updateWeek,
  type WeekActionState,
} from "@/app/commissioner/actions";
import type { WeekStatus } from "@/lib/database.types";
import { toChicagoDateAndTimeInputs } from "@/lib/time/chicago";

const initialState: WeekActionState = { error: null, success: null };

const STATUS_OPTIONS: WeekStatus[] = [
  "upcoming",
  "open",
  "locked",
  "final",
];

type WeekCardModel = {
  id: string;
  week_number: number;
  label: string;
  locks_at: string;
  status: WeekStatus;
  locksAtLabel: string;
  editable: boolean;
};

export function CreateWeekForm() {
  const [state, action, pending] = useActionState(createWeek, initialState);

  return (
    <form
      action={action}
      className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-base font-semibold text-stone-900">Create week</h2>
      <p className="text-sm text-stone-600">
        Lock times are entered and stored using Central Time (
        America/Chicago).
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

      <Field label="Status" htmlFor="create-status">
        <select id="create-status" name="status" className={inputClass} defaultValue="upcoming">
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </Field>

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

  return (
    <article className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-stone-900">
            Week {week.week_number}
          </h3>
          <p className="text-sm text-stone-600">{week.label}</p>
        </div>
        <StatusBadge status={week.status} />
      </div>

      <p className="text-sm text-stone-700">
        <span className="font-medium">Locks:</span> {week.locksAtLabel}
      </p>

      {week.editable ? (
        <form action={editAction} className="space-y-3 border-t border-stone-100 pt-3">
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
          <Field label="Status" htmlFor={`status-${week.id}`}>
            <select
              id={`status-${week.id}`}
              name="status"
              className={inputClass}
              defaultValue={week.status}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </Field>
          <Feedback state={editState} />
          <button
            type="submit"
            disabled={editPending}
            className={secondaryButtonClass}
          >
            {editPending ? "Saving…" : "Save changes"}
          </button>
        </form>
      ) : (
        <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
          Lock time has passed. Editing label/lock/status for unlocked future
          weeks only.
        </p>
      )}

      <div className="flex flex-col gap-2 border-t border-stone-100 pt-3">
        {week.status !== "open" ? (
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

        {week.status === "open" || week.status === "upcoming" ? (
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
    </article>
  );
}

function StatusBadge({ status }: { status: WeekStatus }) {
  const styles: Record<WeekStatus, string> = {
    upcoming: "bg-stone-100 text-stone-700",
    open: "bg-emerald-100 text-emerald-900",
    locked: "bg-amber-100 text-amber-950",
    final: "bg-slate-200 text-slate-800",
  };
  return (
    <span
      className={`rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide ${styles[status]}`}
    >
      {status}
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
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white transition enabled:active:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-emerald-800 bg-white px-4 text-sm font-semibold text-emerald-900 transition enabled:active:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60";

const dangerButtonClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-red-800 px-4 text-sm font-semibold text-white transition enabled:active:bg-red-950 disabled:cursor-not-allowed disabled:opacity-60";

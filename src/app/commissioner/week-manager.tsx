"use client";

import { useActionState, useState, type ReactNode } from "react";

import {
  activateSeason,
  createWeek,
  generateSeasonCalendar,
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

export function SeasonCalendarForm({ weekCount }: { weekCount: number }) {
  const [state, action, pending] = useActionState(
    generateSeasonCalendar,
    initialState,
  );

  const placeholder = JSON.stringify(
    Array.from({ length: weekCount }, (_, index) => ({
      week_number: index + 1,
      label: `Week ${index + 1}`,
      lock_date: "YYYY-MM-DD",
      lock_time: "12:00",
    })),
    null,
    2,
  );

  return (
    <form
      action={action}
      className="space-y-3 rounded-2xl border border-emerald-300 bg-emerald-50/50 p-4 shadow-sm"
    >
      <h2 className="text-base font-semibold text-stone-900">
        Configure season calendar
      </h2>
      <p className="text-sm leading-relaxed text-stone-700">
        Provide all {weekCount} regular-season deadlines in Central Time as JSON.
        Existing weeks are never overwritten. Safe to retry.
      </p>
      <Field label="Season calendar JSON (Central Time deadlines)" htmlFor="calendar-json">
        <textarea
          id="calendar-json"
          name="calendar_json"
          required
          rows={12}
          spellCheck={false}
          placeholder={placeholder}
          className={`${inputClass} min-h-48 font-mono text-sm`}
        />
      </Field>
      <Feedback state={state} />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Generating…" : `Generate weeks 1–${weekCount}`}
      </button>
    </form>
  );
}

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
        Activation moves the season from setup to active. Players can then
        submit picks for the effective current week, which advances
        automatically by deadline. This cannot be undone from the app.
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
    <details className="rounded-2xl border border-stone-300 bg-stone-50 p-4">
      <summary className="min-h-11 cursor-pointer text-sm font-semibold text-stone-800">
        Exceptional: create a single week manually
      </summary>
      <form action={action} className="mt-3 space-y-3">
        <p className="text-sm text-stone-600">
          Prefer the full calendar generator. Use this only for rare corrections.
          New weeks start as upcoming; deadline must be in the future (Central
          Time).
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

        <button type="submit" disabled={pending} className={secondaryButtonClass}>
          {pending ? "Creating…" : "Create single week"}
        </button>
      </form>
    </details>
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

      {week.presentation.kind === "deadline_passed" ? (
        <p className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-950">
          The deadline has passed. Lock this week when you are ready; it is
          already skipped for player picks.
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
                <span>
                  I confirm locking Week {week.week_number}
                  {week.status === "upcoming" ? " early" : ""}.
                </span>
              </label>
              <button
                type="submit"
                disabled={statusPending || !confirmLock}
                className={dangerButtonClass}
              >
                {statusPending ? "Locking…" : "Lock week"}
              </button>
            </form>
          ) : null}

          {showOpen ? (
            <details className="rounded-lg border border-stone-300 bg-stone-50 p-3">
              <summary className="min-h-11 cursor-pointer text-sm font-semibold text-stone-800">
                Exceptional: mark stored status open
              </summary>
              <p className="mt-2 text-sm text-stone-600">
                Not required for routine weeks. Current-week eligibility is
                deadline-based. Use only for legacy/open-status corrections.
              </p>
              <form action={statusAction} className="mt-2">
                <input type="hidden" name="week_id" value={week.id} />
                <input type="hidden" name="status" value="open" />
                <button
                  type="submit"
                  disabled={statusPending}
                  className={secondaryButtonClass}
                >
                  {statusPending ? "Saving…" : "Set status to open"}
                </button>
              </form>
            </details>
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

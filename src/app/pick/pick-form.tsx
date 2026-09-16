"use client";

import { useActionState, useMemo, useState } from "react";

import { savePick, type PickActionState } from "@/app/pick/actions";

export type PickTeamOption = {
  id: string;
  abbreviation: string;
  city: string;
  name: string;
  used: boolean;
};

type PickFormProps = {
  teams: PickTeamOption[];
  initialTeamId: string | null;
  weekLabel: string;
  deadlineLabel: string;
  locked: boolean;
};

const initialState: PickActionState = {
  error: null,
  success: null,
  savedTeamId: null,
  savedTeamLabel: null,
};

export function PickForm({
  teams,
  initialTeamId,
  weekLabel,
  deadlineLabel,
  locked,
}: PickFormProps) {
  const [state, action, pending] = useActionState(savePick, initialState);
  const [query, setQuery] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState(
    state.savedTeamId ?? initialTeamId,
  );

  const effectiveSelected =
    state.savedTeamId ?? selectedTeamId ?? initialTeamId;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return teams;
    }
    return teams.filter((team) => {
      const haystack =
        `${team.city} ${team.name} ${team.abbreviation}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [teams, query]);

  const selectedTeam =
    teams.find((team) => team.id === effectiveSelected) ?? null;

  if (locked) {
    return (
      <section
        className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm"
        aria-live="polite"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
          Locked
        </p>
        <h2 className="mt-1 text-lg font-semibold text-amber-950">
          {weekLabel} is locked
        </h2>
        <p className="mt-1 text-sm text-amber-900">
          Deadline was {deadlineLabel}. Your pick can no longer be changed.
        </p>
        {selectedTeam ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-white px-3 py-3 text-base font-semibold text-stone-900">
            Locked selection: {selectedTeam.city} {selectedTeam.name} (
            {selectedTeam.abbreviation})
          </p>
        ) : (
          <p className="mt-4 text-sm font-medium text-amber-950">
            No pick was submitted before the deadline.
          </p>
        )}
      </section>
    );
  }

  return (
    <form action={action} className="pb-28">
      <div className="mb-3 rounded-2xl border border-emerald-900/10 bg-emerald-950 p-4 text-emerald-50 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/80">
          Current week
        </p>
        <h2 className="mt-1 text-lg font-semibold">{weekLabel}</h2>
        <p className="mt-1 text-sm text-emerald-100/90">
          Deadline: {deadlineLabel} (Central Time)
        </p>
        {selectedTeam ? (
          <p className="mt-3 rounded-lg bg-emerald-900/50 px-3 py-2 text-sm">
            Selected:{" "}
            <strong>
              {selectedTeam.city} {selectedTeam.name} ({selectedTeam.abbreviation})
            </strong>
          </p>
        ) : (
          <p className="mt-3 text-sm text-emerald-100/80">No team selected yet.</p>
        )}
      </div>

      <label htmlFor="team-filter" className="sr-only">
        Filter teams
      </label>
      <input
        id="team-filter"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search teams"
        className="mb-3 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none ring-emerald-700/30 focus:border-emerald-700 focus:ring-2"
      />

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-stone-800">
          Choose one available team
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {filtered.map((team) => {
            const selected = effectiveSelected === team.id;
            const disabled = team.used && !selected;
            return (
              <label
                key={team.id}
                className={[
                  "relative flex min-h-[4.5rem] cursor-pointer flex-col justify-center rounded-xl border px-3 py-3 text-left transition",
                  selected
                    ? "border-emerald-700 bg-emerald-50 ring-2 ring-emerald-700"
                    : "border-stone-200 bg-white",
                  disabled
                    ? "cursor-not-allowed border-red-200 bg-red-50 opacity-80"
                    : "active:border-emerald-600",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="team_id"
                  value={team.id}
                  className="sr-only"
                  disabled={disabled || pending}
                  checked={selected}
                  onChange={() => setSelectedTeamId(team.id)}
                />
                <span className="text-sm font-semibold text-stone-900">
                  {team.abbreviation}
                </span>
                <span className="text-xs leading-snug text-stone-600">
                  {team.city} {team.name}
                </span>
                {disabled ? (
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-red-800">
                    <span aria-hidden>✕</span> Used
                  </span>
                ) : selected ? (
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-emerald-800">
                    <span aria-hidden>✓</span> Selected
                  </span>
                ) : (
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                    <span aria-hidden>○</span> Available
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>

      {state.error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p
          role="status"
          className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          {state.success}
        </p>
      ) : null}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#f3f6f1] via-[#f3f6f1]/95 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-8">
        <div className="pointer-events-auto mx-auto flex w-full max-w-lg flex-col gap-2">
          <p className="text-center text-xs text-stone-600">
            {selectedTeam
              ? `Ready to save ${selectedTeam.abbreviation}`
              : "Select a team to save"}
          </p>
          <button
            type="submit"
            disabled={pending || !effectiveSelected}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-800 px-4 text-base font-semibold text-white shadow-lg transition enabled:active:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving pick…" : "Save Pick"}
          </button>
        </div>
      </div>
    </form>
  );
}

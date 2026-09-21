"use client";

import { useActionState, useMemo, useState } from "react";

import { savePick, type PickActionState } from "@/app/pick/actions";
import type { PickGameOption } from "@/lib/nfl/schedule-query";

type PickFormProps = {
  weekId: string;
  teams: PickGameOption[];
  initialTeamId: string | null;
  weekLabel: string;
  deadlineLabel: string;
  locked: boolean;
  noEligibleGames?: boolean;
  lastSyncLabel: string;
  nowMs: number;
};

const initialState: PickActionState = {
  error: null,
  success: null,
  savedTeamId: null,
  savedTeamLabel: null,
};

function formatKickoff(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

export function PickForm({
  weekId,
  teams,
  initialTeamId,
  weekLabel,
  deadlineLabel,
  locked,
  noEligibleGames = false,
  lastSyncLabel,
  nowMs,
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
    if (!needle) return teams;
    return teams.filter((team) => {
      const haystack =
        `${team.city} ${team.name} ${team.abbreviation} ${team.opponentAbbreviation}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [teams, query]);

  const selectedTeam =
    teams.find((team) => team.teamId === effectiveSelected) ?? null;

  const kickoffWarning =
    selectedTeam &&
    !selectedTeam.locked &&
    new Date(selectedTeam.kickoffAt).getTime() - nowMs < 2 * 60 * 60 * 1000;

  if (noEligibleGames) {
    return (
      <section
        className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
        aria-live="polite"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Your pick
        </p>
        <h2 className="mt-1 text-lg font-semibold text-stone-900">
          Pick window closed for {weekLabel}
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          No eligible unstarted games remain. Used and kicked-off teams cannot
          be selected.
        </p>
      </section>
    );
  }

  if (locked) {
    return (
      <section
        className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm"
        aria-live="polite"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
          Locked at kickoff
        </p>
        <h2 className="mt-1 text-lg font-semibold text-amber-950">
          {weekLabel} pick is locked
        </h2>
        <p className="mt-1 text-sm text-amber-900">{deadlineLabel}</p>
        {selectedTeam ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-white px-3 py-3 text-base font-semibold text-stone-900">
            Selection: {selectedTeam.city} {selectedTeam.name} (
            {selectedTeam.abbreviation})
          </p>
        ) : null}
        <p className="mt-3 text-xs text-amber-900">
          Schedule sync: {lastSyncLabel}
        </p>
      </section>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <input type="hidden" name="week_id" value={weekId} />
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
          Your pick · {weekLabel}
        </p>
        <h2 className="text-xl font-semibold text-stone-900">
          {initialTeamId ? "Change your team" : "Choose a team"}
        </h2>
        <p className="text-sm text-stone-600">{deadlineLabel}</p>
        {selectedTeam && !selectedTeam.locked ? (
          <p className="text-sm font-medium text-stone-800">
            Locks at {formatKickoff(selectedTeam.kickoffAt)} for{" "}
            {selectedTeam.abbreviation}.
          </p>
        ) : null}
        <p className="text-xs text-stone-500">
          Last schedule sync: {lastSyncLabel}
        </p>
      </header>

      {state.error ? (
        <p
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          role="status"
        >
          {state.success}
        </p>
      ) : null}
      {kickoffWarning ? (
        <p
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="status"
        >
          Your selection kicks off soon (
          {formatKickoff(selectedTeam!.kickoffAt)}). Changing after kickoff is
          rejected by the database.
        </p>
      ) : null}

      <label className="block space-y-1">
        <span className="text-sm font-medium text-stone-800">Search teams</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-base text-stone-900"
          placeholder="Team or opponent"
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="sr-only">Teams playing this week</legend>
        {filtered.map((team) => {
          const disabled = team.used || team.locked;
          const selected = effectiveSelected === team.teamId;
          return (
            <label
              key={`${team.gameId}-${team.teamId}`}
              className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border px-3 py-3 ${
                selected
                  ? "border-emerald-600 bg-emerald-50"
                  : "border-stone-200 bg-white"
              } ${disabled ? "opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="team_id"
                value={team.teamId}
                checked={selected}
                disabled={disabled || pending}
                onChange={() => setSelectedTeamId(team.teamId)}
                className="mt-1 h-5 w-5"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-stone-900">
                  {team.city} {team.name} ({team.abbreviation})
                </span>
                <span className="mt-0.5 block text-sm text-stone-600">
                  {team.homeAway === "home" ? "vs" : "@"}{" "}
                  {team.opponentAbbreviation} · {formatKickoff(team.kickoffAt)}
                </span>
                <span className="mt-1 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
                  {team.used ? (
                    <span className="text-stone-500">Used</span>
                  ) : null}
                  {team.locked ? (
                    <span className="text-amber-800">Locked</span>
                  ) : (
                    <span className="text-emerald-800">Open</span>
                  )}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <button
        type="submit"
        disabled={pending || !effectiveSelected}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-800 px-4 text-base font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save pick"}
      </button>
    </form>
  );
}

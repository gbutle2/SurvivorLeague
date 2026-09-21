"use client";

import { useActionState, useId, useMemo, useState, useTransition } from "react";

import { savePick, type PickActionState } from "@/app/pick/actions";
import type { PickGameOption } from "@/lib/nfl/schedule-query";
import {
  defaultPickEditorExpanded,
  formatPickDeadlineLine,
  resolvePickEditorMode,
  type PickEditorMode,
} from "@/lib/picks/eligibility";

type PickFormProps = {
  weekId: string;
  weekNumber: number;
  teams: PickGameOption[];
  initialTeamId: string | null;
  weekLabel: string;
  locked: boolean;
  noEligibleGames?: boolean;
  scheduleUnavailable?: boolean;
  lastSyncLabel: string;
  nowMs: number;
  /** Pending / win / loss / tie when known for the saved pick. */
  pickResult?: string | null;
};

const initialState: PickActionState = {
  error: null,
  success: null,
  savedTeamId: null,
  savedTeamLabel: null,
};

type PanelIntent = "default" | "open" | "closed";

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

function statusLine(args: {
  mode: PickEditorMode;
  locked: boolean;
  kickoffAt: string | null;
  pickResult: string | null | undefined;
}): string {
  const result = args.pickResult?.toLowerCase();
  if (result === "win" || result === "loss" || result === "tie") {
    return `Final · ${result}`;
  }
  return formatPickDeadlineLine({
    locked: args.locked || args.mode === "locked",
    kickoffAt: args.kickoffAt,
    formatKickoff,
  });
}

export function PickForm({
  weekId,
  weekNumber,
  teams,
  initialTeamId,
  weekLabel,
  locked,
  noEligibleGames = false,
  scheduleUnavailable = false,
  lastSyncLabel,
  nowMs,
  pickResult = null,
}: PickFormProps) {
  const panelId = useId();
  const [state, action, pending] = useActionState(savePick, initialState);
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState(
    state.savedTeamId ?? initialTeamId,
  );
  const [intent, setIntent] = useState<PanelIntent>("default");
  const [dismissedError, setDismissedError] = useState(false);
  const [dismissedSuccess, setDismissedSuccess] = useState(false);
  const [seenSuccess, setSeenSuccess] = useState<string | null>(null);
  const [seenError, setSeenError] = useState<string | null>(null);

  // Adjust panel intent when the server action result changes (React render-time sync).
  if (state.success && state.success !== seenSuccess) {
    setSeenSuccess(state.success);
    setIntent("closed");
    setDismissedError(true);
    setDismissedSuccess(false);
    setSelectedTeamId(state.savedTeamId);
    setQuery("");
  }
  if (state.error && state.error !== seenError) {
    setSeenError(state.error);
    setIntent("open");
    setDismissedError(false);
    setDismissedSuccess(true);
  }

  const mode = resolvePickEditorMode({
    hasExistingPick: Boolean(state.savedTeamId ?? initialTeamId),
    existingPickLocked: locked,
    noEligibleGames,
    scheduleUnavailable,
  });

  const expanded =
    intent === "open"
      ? true
      : intent === "closed"
        ? false
        : defaultPickEditorExpanded(mode);

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

  const savedTeam =
    teams.find(
      (team) => team.teamId === (state.savedTeamId ?? initialTeamId),
    ) ?? null;

  const displayError =
    state.error && !dismissedError ? state.error : null;
  const displaySuccess =
    state.success && !dismissedSuccess ? state.success : null;

  function expandEditor() {
    if (mode === "locked" || mode === "unavailable") return;
    setIntent("open");
    setDismissedError(true);
    setDismissedSuccess(true);
  }

  function collapseEditor() {
    setIntent("closed");
    setSelectedTeamId(state.savedTeamId ?? initialTeamId);
    setQuery("");
    setDismissedError(true);
    setDismissedSuccess(true);
  }

  function onSelectTeam(teamId: string) {
    setSelectedTeamId(teamId);
    setDismissedError(true);
    setDismissedSuccess(true);
  }

  const kickoffWarning =
    selectedTeam &&
    !selectedTeam.locked &&
    new Date(selectedTeam.kickoffAt).getTime() - nowMs < 2 * 60 * 60 * 1000;

  const summaryKickoff = savedTeam?.kickoffAt ?? selectedTeam?.kickoffAt ?? null;
  const summaryStatus = statusLine({
    mode,
    locked,
    kickoffAt: summaryKickoff,
    pickResult,
  });

  if (mode === "unavailable") {
    return (
      <section
        className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
        aria-live="polite"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Your Pick · Week {weekNumber}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-stone-900">
          {scheduleUnavailable
            ? `Schedule unavailable for ${weekLabel}`
            : `No eligible games for ${weekLabel}`}
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          {scheduleUnavailable
            ? `The schedule for Week ${weekNumber} is not available yet.`
            : "Bye weeks and kicked-off games cannot be selected."}
        </p>
        <p className="mt-3 text-xs text-stone-500">
          Schedule sync: {lastSyncLabel}
        </p>
      </section>
    );
  }

  const canEdit = mode === "editable" || mode === "no_pick";
  const showEditor = expanded && canEdit;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Your Pick · Week {weekNumber}
          </p>
          {savedTeam || selectedTeam ? (
            <>
              <h2 className="mt-1 text-lg font-semibold text-stone-900">
                {(savedTeam ?? selectedTeam)!.city}{" "}
                {(savedTeam ?? selectedTeam)!.name} (
                {(savedTeam ?? selectedTeam)!.abbreviation})
              </h2>
              <p className="mt-0.5 text-sm text-stone-600">
                {(savedTeam ?? selectedTeam)!.homeAway === "home" ? "vs" : "@"}{" "}
                {(savedTeam ?? selectedTeam)!.opponentAbbreviation}
                {summaryKickoff ? ` · ${formatKickoff(summaryKickoff)}` : ""}
              </p>
              <p className="mt-1 text-sm font-medium text-stone-800">
                {summaryStatus}
              </p>
            </>
          ) : (
            <>
              <h2 className="mt-1 text-lg font-semibold text-stone-900">
                No pick submitted
              </h2>
              <p className="mt-1 text-sm text-stone-600">
                Choose a team before that game’s kickoff.
              </p>
            </>
          )}
        </div>
        {canEdit ? (
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-800"
            aria-expanded={showEditor}
            aria-controls={panelId}
            onClick={() => {
              if (showEditor) collapseEditor();
              else expandEditor();
            }}
          >
            <span aria-hidden="true">{showEditor ? "▾" : "▸"}</span>
            <span className="sr-only">
              {showEditor ? "Collapse pick editor" : "Expand pick editor"}
            </span>
          </button>
        ) : null}
      </div>

      {canEdit && !showEditor ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-800 px-4 text-sm font-semibold text-white"
            aria-expanded={false}
            aria-controls={panelId}
            onClick={expandEditor}
          >
            {mode === "no_pick" ? "Make pick" : "Change pick"}
          </button>
        </div>
      ) : null}

      {mode === "locked" ? (
        <p className="mt-3 text-xs text-stone-500">
          Schedule sync: {lastSyncLabel}
        </p>
      ) : null}

      {showEditor ? (
        <form
          id={panelId}
          action={action}
          className="mt-4 space-y-4 border-t border-stone-100 pt-4"
          onSubmit={() => {
            setDismissedError(false);
            setDismissedSuccess(false);
          }}
        >
          <input type="hidden" name="week_id" value={weekId} />
          <header className="space-y-1">
            <h3 className="text-base font-semibold text-stone-900">
              {initialTeamId || state.savedTeamId
                ? "Change your team"
                : "Choose a team"}
            </h3>
            {selectedTeam ? (
              <p className="text-sm font-medium text-stone-800">
                {formatPickDeadlineLine({
                  locked: false,
                  kickoffAt: selectedTeam.kickoffAt,
                  formatKickoff,
                })}{" "}
                for {selectedTeam.abbreviation}.
              </p>
            ) : (
              <p className="text-sm text-stone-600">
                Editable until your selected team’s kickoff (Central Time).
              </p>
            )}
            <p className="text-xs text-stone-500">
              Last schedule sync: {lastSyncLabel}
            </p>
          </header>

          {displayError ? (
            <p
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
              role="alert"
            >
              {displayError}
            </p>
          ) : null}
          {displaySuccess ? (
            <p
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              role="status"
            >
              {displaySuccess}
            </p>
          ) : null}
          {kickoffWarning ? (
            <p
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
              role="status"
            >
              Your selection kicks off soon (
              {formatKickoff(selectedTeam!.kickoffAt)}). Changing after kickoff
              is rejected by the database.
            </p>
          ) : null}

          <label className="block space-y-1">
            <span className="text-sm font-medium text-stone-800">
              Search teams
            </span>
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
              const isCurrent =
                team.teamId === effectiveSelected ||
                team.teamId === initialTeamId ||
                team.teamId === state.savedTeamId;
              const disabled = (team.used || team.locked) && !isCurrent;
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
                    onChange={() => onSelectTeam(team.teamId)}
                    className="mt-1 h-5 w-5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-stone-900">
                      {team.city} {team.name} ({team.abbreviation})
                    </span>
                    <span className="mt-0.5 block text-sm text-stone-600">
                      {team.homeAway === "home" ? "vs" : "@"}{" "}
                      {team.opponentAbbreviation} ·{" "}
                      {formatKickoff(team.kickoffAt)}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
                      {team.used && !isCurrent ? (
                        <span className="text-stone-500">Used</span>
                      ) : null}
                      {team.locked && !isCurrent ? (
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

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="submit"
              disabled={pending || !effectiveSelected}
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-emerald-800 px-4 text-base font-semibold text-white disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save pick"}
            </button>
            <button
              type="button"
              disabled={pending}
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-stone-300 bg-white px-4 text-base font-semibold text-stone-800 disabled:opacity-60"
              onClick={() => {
                startTransition(() => {
                  collapseEditor();
                });
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div id={panelId} hidden={!canEdit} />
      )}
    </section>
  );
}

export type { PickEditorMode };

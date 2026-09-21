"use client";

import { useActionState, useId, useMemo, useState, useTransition } from "react";

import { savePick, type PickActionState } from "@/app/pick/actions";
import type { PickGameOption } from "@/lib/nfl/schedule-query";
import {
  defaultPickEditorExpanded,
  formatPickDeadlineLine,
  PICK_UNVERIFIED_MESSAGE,
  resolvePickEditorMode,
  type ExistingPickLockState,
  type PickEditorMode,
} from "@/lib/picks/eligibility";
import type { SavedPickSummary } from "@/lib/picks/saved-summary";

export type PickFormProps = {
  weekId: string;
  weekNumber: number;
  teams: PickGameOption[];
  initialTeamId: string | null;
  weekLabel: string;
  /** Tri-state for an existing saved pick; ignored when there is no pick. */
  existingPickState?: ExistingPickLockState;
  noEligibleGames?: boolean;
  scheduleUnavailable?: boolean;
  lastSyncLabel: string;
  nowMs: number;
  pickResult?: string | null;
  /** Authoritative saved-team display (not derived from filtered options). */
  savedSummary?: SavedPickSummary | null;
  /** Optional action override for rendered tests. */
  actionOverride?: typeof savePick;
  /** Optional initial action state for rendered tests (e.g. stale error). */
  initialActionState?: PickActionState;
};

const defaultInitialState: PickActionState = {
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
  kickoffAt: string | null;
  pickResult: string | null | undefined;
}): string {
  const result = args.pickResult?.toLowerCase();
  if (result === "win" || result === "loss" || result === "tie") {
    return `Final · ${result}`;
  }
  if (args.mode === "unverified") {
    return "Schedule verification needed";
  }
  return formatPickDeadlineLine({
    locked: args.mode === "locked",
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
  existingPickState = "editable",
  noEligibleGames = false,
  scheduleUnavailable = false,
  lastSyncLabel,
  nowMs,
  pickResult = null,
  savedSummary = null,
  actionOverride,
  initialActionState,
}: PickFormProps) {
  const panelId = useId();
  const [state, action, pending] = useActionState(
    actionOverride ?? savePick,
    initialActionState ?? defaultInitialState,
  );
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

  const hasExistingPick = Boolean(state.savedTeamId ?? initialTeamId);
  const mode = resolvePickEditorMode({
    hasExistingPick,
    existingPickState: hasExistingPick ? existingPickState : "editable",
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

  const selectedFromOptions =
    teams.find((team) => team.teamId === effectiveSelected) ?? null;

  const displaySummary: SavedPickSummary | null =
    savedSummary &&
    (savedSummary.teamId === (state.savedTeamId ?? initialTeamId) ||
      !state.savedTeamId)
      ? savedSummary
      : selectedFromOptions
        ? {
            teamId: selectedFromOptions.teamId,
            abbreviation: selectedFromOptions.abbreviation,
            city: selectedFromOptions.city,
            name: selectedFromOptions.name,
            opponentAbbreviation: selectedFromOptions.opponentAbbreviation,
            homeAway: selectedFromOptions.homeAway,
            kickoffAt: selectedFromOptions.kickoffAt,
          }
        : savedSummary;

  const displayError =
    state.error && !dismissedError ? state.error : null;
  const displaySuccess =
    state.success && !dismissedSuccess ? state.success : null;

  function expandEditor() {
    if (
      mode === "locked" ||
      mode === "unavailable" ||
      mode === "unverified"
    ) {
      return;
    }
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
    selectedFromOptions &&
    !selectedFromOptions.locked &&
    new Date(selectedFromOptions.kickoffAt).getTime() - nowMs <
      2 * 60 * 60 * 1000;

  const summaryKickoff = displaySummary?.kickoffAt ?? null;
  const summaryStatus = statusLine({
    mode,
    kickoffAt: summaryKickoff,
    pickResult,
  });

  if (mode === "unavailable" || mode === "unverified") {
    return (
      <section
        className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
        aria-live="polite"
        data-pick-mode={mode}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Your Pick · Week {weekNumber}
        </p>
        {displaySummary ? (
          <>
            <h2 className="mt-1 text-lg font-semibold text-stone-900">
              {displaySummary.city} {displaySummary.name} (
              {displaySummary.abbreviation})
            </h2>
            {displaySummary.opponentAbbreviation ? (
              <p className="mt-0.5 text-sm text-stone-600">
                {displaySummary.homeAway === "home" ? "vs" : "@"}{" "}
                {displaySummary.opponentAbbreviation}
                {summaryKickoff ? ` · ${formatKickoff(summaryKickoff)}` : ""}
              </p>
            ) : null}
          </>
        ) : (
          <h2 className="mt-1 text-lg font-semibold text-stone-900">
            {mode === "unverified"
              ? "Saved pick"
              : scheduleUnavailable
                ? `Schedule unavailable for ${weekLabel}`
                : `No eligible games for ${weekLabel}`}
          </h2>
        )}
        <p className="mt-2 text-sm text-stone-700" role="status">
          {mode === "unverified"
            ? PICK_UNVERIFIED_MESSAGE
            : scheduleUnavailable
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
    <section
      className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
      data-pick-mode={mode}
      data-pick-expanded={showEditor ? "true" : "false"}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Your Pick · Week {weekNumber}
          </p>
          {displaySummary ? (
            <>
              <h2 className="mt-1 text-lg font-semibold text-stone-900">
                {displaySummary.city} {displaySummary.name} (
                {displaySummary.abbreviation})
              </h2>
              <p className="mt-0.5 text-sm text-stone-600">
                {displaySummary.opponentAbbreviation
                  ? `${displaySummary.homeAway === "home" ? "vs" : "@"} ${displaySummary.opponentAbbreviation}`
                  : null}
                {summaryKickoff
                  ? `${displaySummary.opponentAbbreviation ? " · " : ""}${formatKickoff(summaryKickoff)}`
                  : ""}
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
            data-testid="pick-expand-toggle"
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
            data-testid="pick-primary-action"
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
          data-testid="pick-editor"
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
            {selectedFromOptions ? (
              <p className="text-sm font-medium text-stone-800">
                {formatPickDeadlineLine({
                  locked: false,
                  kickoffAt: selectedFromOptions.kickoffAt,
                  formatKickoff,
                })}{" "}
                for {selectedFromOptions.abbreviation}.
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
              data-testid="pick-error"
            >
              {displayError}
            </p>
          ) : null}
          {displaySuccess ? (
            <p
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              role="status"
              data-testid="pick-success"
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
              {formatKickoff(selectedFromOptions!.kickoffAt)}). Changing after
              kickoff is rejected by the database.
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
              data-testid="pick-search"
            />
          </label>

          <fieldset className="space-y-2" data-testid="pick-team-list">
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
              data-testid="pick-save"
            >
              {pending ? "Saving…" : "Save pick"}
            </button>
            <button
              type="button"
              disabled={pending}
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-stone-300 bg-white px-4 text-base font-semibold text-stone-800 disabled:opacity-60"
              data-testid="pick-cancel"
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

"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  commissionerOverridePick,
  previewOverride,
  type CommissionerWeekPickRow,
  type OverrideActionState,
  type WeekTeamOption,
} from "@/app/commissioner/picks/actions";
import { resultLabel } from "@/lib/commissioner/override-errors";
import { formatCentralDateTime } from "@/lib/time/chicago";

type WeekOption = {
  id: string;
  week_number: number;
  label: string;
  status: string;
  contextLabel: string;
};

type ManagePicksProps = {
  weeks: WeekOption[];
  selectedWeekId: string;
  players: CommissionerWeekPickRow[];
  teams: WeekTeamOption[];
};

const initialState: OverrideActionState = {
  error: null,
  success: null,
  auditId: null,
  targetUserId: null,
  result: null,
  points: null,
  cleared: false,
};

function pickLabel(row: CommissionerWeekPickRow): string {
  if (!row.team_id || !row.team_abbreviation) return "No pick";
  return `${row.team_city} ${row.team_name} (${row.team_abbreviation})`;
}

export function ManagePicks({
  weeks,
  selectedWeekId,
  players,
  teams,
}: ManagePicksProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<{
    userId: string;
    displayName: string;
    previousLabel: string;
    previousResult: string;
    previousPoints: number;
    teamId: string | null;
    newLabel: string;
    newResult: string;
    newPoints: number;
    kickoffPassed: boolean;
    weekFinal: boolean;
    clear: boolean;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [draftTeams, setDraftTeams] = useState<Record<string, string>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, startPreview] = useTransition();

  async function overrideAction(
    prev: OverrideActionState,
    formData: FormData,
  ): Promise<OverrideActionState> {
    const next = await commissionerOverridePick(prev, formData);
    if (next.success) {
      setConfirming(null);
      setReason("");
    }
    return next;
  }

  const [state, action, pending] = useActionState(overrideAction, initialState);

  const selectedWeek =
    weeks.find((week) => week.id === selectedWeekId) ?? weeks[0];

  const teamById = useMemo(() => {
    const map = new Map(teams.map((team) => [team.teamId, team]));
    return map;
  }, [teams]);

  function onWeekChange(weekId: string) {
    router.push(`/commissioner/picks?week=${weekId}`);
  }

  function openConfirm(row: CommissionerWeekPickRow, clear: boolean) {
    setPreviewError(null);
    const selected = clear
      ? null
      : (draftTeams[row.user_id] ?? row.team_id ?? "");
    const teamId = selected && selected !== "__none__" ? selected : null;

    if (!clear && !teamId) {
      setPreviewError("Select a team or use Clear pick.");
      return;
    }

    startPreview(async () => {
      const preview = await previewOverride(selectedWeekId, teamId);
      if (preview.error) {
        setPreviewError(preview.error);
        return;
      }

      const team = teamId ? teamById.get(teamId) : null;
      const newLabel = clear
        ? "No pick"
        : team
          ? `${team.city} ${team.name} (${team.abbreviation})`
          : "Unknown team";

      setConfirming({
        userId: row.user_id,
        displayName: row.display_name,
        previousLabel: pickLabel(row),
        previousResult: resultLabel(row.result),
        previousPoints: row.points,
        teamId,
        newLabel,
        newResult: clear ? "No pick" : resultLabel(preview.result as never),
        newPoints: clear ? 0 : preview.points,
        kickoffPassed: preview.kickoffPassed,
        weekFinal: selectedWeek?.status === "final",
        clear,
      });
      setReason("");
    });
  }

  return (
    <div className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-medium text-stone-800">Week</span>
        <select
          className="min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-base text-stone-900"
          value={selectedWeekId}
          onChange={(event) => onWeekChange(event.target.value)}
        >
          {weeks.map((week) => (
            <option key={week.id} value={week.id}>
              Week {week.week_number} · {week.contextLabel}
            </option>
          ))}
        </select>
      </label>

      {state.success ? (
        <p
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950"
          role="status"
        >
          {state.success}
          {state.auditId ? ` Audit ${state.auditId.slice(0, 8)}…` : ""}
        </p>
      ) : null}
      {state.error ? (
        <p
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      {previewError ? (
        <p
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="alert"
        >
          {previewError}
        </p>
      ) : null}

      <ul className="space-y-3">
        {players.map((row) => {
          const draft = draftTeams[row.user_id] ?? row.team_id ?? "__none__";
          const used = new Map(
            row.used_elsewhere.map((entry) => [entry.team_id, entry]),
          );
          return (
            <li
              key={row.user_id}
              className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold text-stone-900">
                  {row.display_name}
                </h3>
                <p className="text-sm text-stone-600">
                  {pickLabel(row)} · {resultLabel(row.result)} · {row.points}{" "}
                  pt{row.points === 1 ? "" : "s"}
                </p>
              </div>

              <label className="mt-3 block space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
                  Team
                </span>
                <select
                  className="min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-base"
                  value={draft}
                  onChange={(event) =>
                    setDraftTeams((prev) => ({
                      ...prev,
                      [row.user_id]: event.target.value,
                    }))
                  }
                >
                  <option value="__none__">No pick</option>
                  {teams.map((team) => {
                    const conflict = used.get(team.teamId);
                    const disabled = !team.playsThisWeek || Boolean(conflict);
                    const label = [
                      `${team.city} ${team.name} (${team.abbreviation})`,
                      !team.playsThisWeek ? "· Bye" : null,
                      conflict ? `· Used week ${conflict.week_number}` : null,
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <option
                        key={team.teamId}
                        value={team.teamId}
                        disabled={disabled}
                      >
                        {label}
                      </option>
                    );
                  })}
                </select>
              </label>

              {row.last_override_at ? (
                <p className="mt-2 text-xs text-stone-500">
                  Last override {formatCentralDateTime(row.last_override_at)}
                  {row.last_override_reason
                    ? `: ${row.last_override_reason}`
                    : ""}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="min-h-11 rounded-xl bg-emerald-800 px-4 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={pending || isPreviewing}
                  onClick={() => openConfirm(row, false)}
                >
                  Save override
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 disabled:opacity-60"
                  disabled={pending || isPreviewing || !row.pick_id}
                  onClick={() => openConfirm(row, true)}
                >
                  Clear pick
                </button>
              </div>

              {state.targetUserId === row.user_id && state.success ? (
                <p className="mt-2 text-sm text-emerald-900" role="status">
                  Saved:{" "}
                  {state.cleared
                    ? "No pick"
                    : `${state.result ?? "pending"} · ${state.points ?? 0} pts`}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {confirming ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="override-confirm-title"
        >
          <form
            action={action}
            className={`w-full max-w-lg space-y-3 rounded-2xl p-4 shadow-xl ${
              confirming.kickoffPassed ||
              confirming.weekFinal ||
              confirming.clear
                ? "border-2 border-amber-500 bg-amber-50"
                : "border border-stone-200 bg-white"
            }`}
          >
            <h2
              id="override-confirm-title"
              className="text-lg font-semibold text-stone-950"
            >
              Confirm override
            </h2>
            <p className="text-sm text-stone-800">
              <strong>{confirming.displayName}</strong> · Week{" "}
              {selectedWeek?.week_number}
            </p>
            <dl className="space-y-1 text-sm text-stone-800">
              <div>
                <dt className="inline font-medium">Previous: </dt>
                <dd className="inline">
                  {confirming.previousLabel} ({confirming.previousResult},{" "}
                  {confirming.previousPoints} pts)
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">New: </dt>
                <dd className="inline">
                  {confirming.newLabel}
                  {confirming.clear
                    ? ""
                    : ` (${confirming.newResult}, ${confirming.newPoints} pts)`}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">Weekly points change: </dt>
                <dd className="inline">
                  {confirming.previousPoints} →{" "}
                  {confirming.clear ? 0 : confirming.newPoints}
                  {confirming.clear ||
                  confirming.previousPoints !== confirming.newPoints
                    ? ` (${
                        (confirming.clear ? 0 : confirming.newPoints) -
                          confirming.previousPoints >=
                        0
                          ? "+"
                          : ""
                      }${
                        (confirming.clear ? 0 : confirming.newPoints) -
                        confirming.previousPoints
                      })`
                    : ""}
                </dd>
              </div>
            </dl>
            {(confirming.kickoffPassed ||
              confirming.weekFinal ||
              confirming.clear) && (
              <p className="rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-950">
                Standings, streak, survivor status, and team availability may
                change. This cannot be undone except by another override.
              </p>
            )}
            <label className="block space-y-1">
              <span className="text-sm font-medium text-stone-900">
                Reason (required)
              </span>
              <textarea
                name="reason"
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                placeholder="e.g. Player submitted pick by text"
                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-base text-stone-900"
              />
            </label>
            <input type="hidden" name="target_user_id" value={confirming.userId} />
            <input type="hidden" name="week_id" value={selectedWeekId} />
            <input
              type="hidden"
              name="team_id"
              value={confirming.teamId ?? ""}
            />
            <input
              type="hidden"
              name="clear"
              value={confirming.clear ? "1" : "0"}
            />
            <input type="hidden" name="confirmed" value="1" />
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="submit"
                disabled={pending || reason.trim() === ""}
                className="min-h-11 rounded-xl bg-emerald-800 px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {confirming.clear ? "Confirm clear" : "Confirm override"}
              </button>
              <button
                type="button"
                className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold"
                onClick={() => setConfirming(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

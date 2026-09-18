import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  ActivateSeasonForm,
  CreateWeekForm,
  SeasonCalendarForm,
  WeekManagerCard,
} from "@/app/commissioner/week-manager";
import { listSeasonWeeks } from "@/app/commissioner/actions";
import { AppShell } from "@/components/app-shell";
import { LeagueContextError } from "@/components/league-context-error";
import { StatusPanel } from "@/components/status-panel";
import {
  isCommissioner,
  loadLeagueContext,
} from "@/lib/league/context";
import { activationBlockedReason } from "@/lib/season/activation";
import { formatCentralDateTime } from "@/lib/time/chicago";
import { resolveCurrentWeek } from "@/lib/weeks/current-week";
import {
  canEditWeekDetails,
  presentWeekState,
} from "@/lib/weeks/lifecycle";
import { summarizeCalendar } from "@/lib/weeks/season-weeks";

export const metadata: Metadata = {
  title: "Commissioner | Sunday Survivor Picks",
};

export default async function CommissionerPage() {
  const result = await loadLeagueContext();

  if (!result.ok) {
    if (result.code === "unauthenticated") {
      redirect("/login");
    }
    return (
      <AppShell title="Commissioner">
        <LeagueContextError code={result.code} message={result.message} />
      </AppShell>
    );
  }

  if (!isCommissioner(result.context)) {
    return (
      <AppShell title="Commissioner">
        <StatusPanel title="Unauthorized" tone="danger">
          <p>Only the league commissioner can manage weeks.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const { context } = result;
  const { weeks, error: weeksError } = await listSeasonWeeks(context.season.id);
  const current = resolveCurrentWeek(weeks);
  const calendar = summarizeCalendar(weeks, context.season.regularWeekCount);
  const activationBlock =
    context.season.status === "setup"
      ? activationBlockedReason({
          status: context.season.status,
          hasScoringRules: Boolean(context.scoringRules),
          weekCount: weeks.length,
        })
      : null;

  return (
    <AppShell
      title="Commissioner"
      subtitle={`${context.league.name} · ${context.season.year} season (${context.season.status})`}
    >
      <div className="space-y-4">
        <StatusPanel title="Season" tone="neutral">
          <p>
            Status: <strong>{context.season.status}</strong>
          </p>
          <p className="mt-1">
            Calendar:{" "}
            <strong>
              {calendar.configured}/{calendar.expected} weeks configured
            </strong>
          </p>
          <p className="mt-1">
            Timezone: <strong>Central Time (America/Chicago)</strong>
          </p>
          {context.scoringRules ? (
            <p className="mt-1 text-stone-600">
              Scoring rules loaded (win {context.scoringRules.correctRegularPickPoints}{" "}
              pt; bonuses {context.scoringRules.bestRecordBonus}/
              {context.scoringRules.longestStreakBonus}/
              {context.scoringRules.survivorBonus}).
            </p>
          ) : (
            <p className="mt-1 text-amber-800">
              Scoring rules row is missing for this season.
            </p>
          )}
        </StatusPanel>

        {context.season.status === "setup" ? (
          <ActivateSeasonForm
            year={context.season.year}
            canActivate={activationBlock === null}
            blockedReason={activationBlock}
          />
        ) : null}

        {!calendar.complete ? (
          <SeasonCalendarForm weekCount={context.season.regularWeekCount} />
        ) : (
          <StatusPanel title="Season calendar ready" tone="success">
            <p>
              All {calendar.expected} weeks are configured. Edit future deadlines
              or open/lock weeks below as needed.
            </p>
          </StatusPanel>
        )}

        {current.kind === "multiple_open" ? (
          <StatusPanel title="Configuration error" tone="danger">
            <p>
              Multiple weeks are marked open (
              {current.weeks.map((week) => `Week ${week.week_number}`).join(", ")}
              ). Lock extras so players have exactly one open week.
            </p>
          </StatusPanel>
        ) : current.kind === "actionable" ? (
          <StatusPanel title="Current actionable week" tone="success">
            <p>
              Week {current.week.week_number}: {current.week.label}. Locks{" "}
              {formatCentralDateTime(current.week.locks_at)}.
            </p>
          </StatusPanel>
        ) : current.kind === "open_expired" ? (
          <StatusPanel title="Open week deadline passed" tone="warning">
            <p>
              Week {current.week.week_number} is still marked open, but the
              deadline ({formatCentralDateTime(current.week.locks_at)}) has
              passed. Lock it when ready.
            </p>
          </StatusPanel>
        ) : current.kind === "informational" ? (
          <StatusPanel title="Next upcoming week" tone="warning">
            <p>
              Week {current.week.week_number}: {current.week.label}. Deadline{" "}
              {formatCentralDateTime(current.week.locks_at)}. Mark it open when
              players should submit picks.
            </p>
          </StatusPanel>
        ) : (
          <StatusPanel title="No weeks yet" tone="warning">
            <p>Configure the season calendar to continue.</p>
          </StatusPanel>
        )}

        {weeksError ? (
          <StatusPanel title="Could not load weeks" tone="danger">
            <p>{weeksError}</p>
          </StatusPanel>
        ) : null}

        <section className="space-y-3" aria-label="Season weeks">
          <h2 className="text-base font-semibold text-stone-900">
            Regular-season weeks
          </h2>
          {weeks.length === 0 ? (
            <StatusPanel title="Calendar empty" tone="neutral">
              <p>Use Configure season calendar above.</p>
            </StatusPanel>
          ) : (
            weeks.map((week) => {
              const presentation = presentWeekState({
                status: week.status,
                locksAt: week.locks_at,
              });
              const editable =
                canEditWeekDetails({
                  status: week.status,
                  locksAt: week.locks_at,
                }) === null;
              return (
                <WeekManagerCard
                  key={week.id}
                  week={{
                    ...week,
                    locksAtLabel: formatCentralDateTime(week.locks_at),
                    editable,
                    presentation,
                  }}
                />
              );
            })
          )}
        </section>

        <CreateWeekForm />
      </div>
    </AppShell>
  );
}

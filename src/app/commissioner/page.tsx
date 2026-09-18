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
              All {calendar.expected} weeks are configured. The current week
              advances automatically by deadline. Use exceptional controls below
              only to edit future deadlines, lock early, or clear stale rows.
            </p>
          </StatusPanel>
        )}

        {current.kind === "actionable" ? (
          <StatusPanel title="Current week (automatic)" tone="success">
            <p>
              Week {current.week.week_number}: {current.week.label}. Picks open
              until {formatCentralDateTime(current.week.locks_at)}. No weekly
              “mark open” step is required.
            </p>
          </StatusPanel>
        ) : (
          <StatusPanel
            title={
              current.reason === "no_weeks"
                ? "No weeks yet"
                : "No eligible current week"
            }
            tone="warning"
          >
            <p>
              {current.reason === "no_weeks"
                ? "Configure the season calendar to continue."
                : "No upcoming/open week with a future deadline remains."}
            </p>
          </StatusPanel>
        )}

        {current.staleExpired.length > 0 ? (
          <StatusPanel title="Stale expired weeks" tone="warning">
            <p>
              These weeks are past deadline but not locked/final:{" "}
              {current.staleExpired
                .map((week) => `Week ${week.week_number}`)
                .join(", ")}
              . Lock them when ready; they are skipped for player picks.
            </p>
          </StatusPanel>
        ) : null}

        {current.multipleOpenWarning.length > 1 ? (
          <StatusPanel title="Legacy open-status warning" tone="warning">
            <p>
              Multiple weeks are stored as open (
              {current.multipleOpenWarning
                .map((week) => `Week ${week.week_number}`)
                .join(", ")}
              ). Player eligibility still uses the earliest eligible week only.
            </p>
          </StatusPanel>
        ) : null}

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
              const isEffectiveCurrent =
                current.kind === "actionable" &&
                current.week.id === week.id;
              const presentation = presentWeekState(
                {
                  status: week.status,
                  locksAt: week.locks_at,
                },
                { isEffectiveCurrent },
              );
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

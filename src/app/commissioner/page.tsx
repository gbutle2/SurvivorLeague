import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ActivateSeasonForm } from "@/app/commissioner/week-manager";
import { SyncNflScheduleForm } from "@/app/commissioner/schedule-sync-form";
import { listSeasonWeeks } from "@/app/commissioner/actions";
import { AppShell } from "@/components/app-shell";
import { LeagueContextError } from "@/components/league-context-error";
import { NavCard } from "@/components/nav-card";
import { StatusPanel } from "@/components/status-panel";
import {
  isCommissioner,
  loadLeagueContext,
} from "@/lib/league/context";
import { loadRegularWeekSignals } from "@/lib/nfl/schedule-query";
import { activationBlockedReason } from "@/lib/season/activation";
import { createClient } from "@/lib/supabase/server";
import { formatCentralDateTime } from "@/lib/time/chicago";
import { resolveCurrentWeekFromGames } from "@/lib/weeks/current-week";

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
          <p>Only the league commissioner can manage the season.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const { context } = result;
  const supabase = await createClient();
  const { weeks, error: weeksError } = await listSeasonWeeks(context.season.id);
  const { signals } = await loadRegularWeekSignals(
    supabase as never,
    context.season.year,
  );
  const current = resolveCurrentWeekFromGames(weeks, signals);

  const { data: lastSync } = await supabase
    .from("schedule_sync_runs")
    .select(
      "completed_at, status, inserted_count, updated_count, rejected_count, warning_summary, source_freshness_at",
    )
    .eq("season_year", context.season.year)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: reviewItems } = await supabase
    .from("schedule_review_items")
    .select("id, kind, summary, created_at")
    .eq("season_year", context.season.year)
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(20);

  const { count: gameCount } = await supabase
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("season_year", context.season.year);

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
        <NavCard
          title="Members"
          description="Create players, issue temporary passwords, and activate or deactivate memberships."
          href="/commissioner/members"
        />

        <StatusPanel title="Season" tone="neutral">
          <p>
            Status: <strong>{context.season.status}</strong>
          </p>
          <p className="mt-1">
            Regular weeks: <strong>{weeks.length}/18</strong> (from NFL sync)
          </p>
          <p className="mt-1">
            Synced games: <strong>{gameCount ?? 0}</strong>
          </p>
          <p className="mt-1">
            Perfect season target: <strong>18-0</strong> · Playoff max:{" "}
            <strong>24</strong> (2/4/6/12)
          </p>
          {context.scoringRules ? (
            <p className="mt-1 text-stone-600">
              Scoring: win {context.scoringRules.correctRegularPickPoints}; bonuses{" "}
              {context.scoringRules.bestRecordBonus}/
              {context.scoringRules.longestStreakBonus}/
              {context.scoringRules.survivorBonus}.
            </p>
          ) : (
            <p className="mt-1 text-amber-800">Scoring rules missing.</p>
          )}
        </StatusPanel>

        <SyncNflScheduleForm seasonYear={context.season.year} />

        <StatusPanel title="Schedule freshness" tone="neutral">
          {lastSync?.completed_at ? (
            <>
              <p>
                Last run: {formatCentralDateTime(lastSync.completed_at)} (
                {lastSync.status})
              </p>
              <p className="mt-1 text-sm text-stone-600">
                Inserted {lastSync.inserted_count}, updated{" "}
                {lastSync.updated_count}, rejected {lastSync.rejected_count}.
              </p>
              {lastSync.source_freshness_at ? (
                <p className="mt-1 text-sm text-stone-600">
                  Provider freshness:{" "}
                  {formatCentralDateTime(lastSync.source_freshness_at)}
                </p>
              ) : null}
              {lastSync.warning_summary ? (
                <p className="mt-2 text-sm text-amber-900">
                  Warnings: {lastSync.warning_summary}
                </p>
              ) : null}
            </>
          ) : (
            <p>No sync has been recorded yet for {context.season.year}.</p>
          )}
          <p className="mt-2 text-xs text-stone-500">
            Vercel Hobby cron refreshes at most daily. Manual sync is the
            fallback. Kickoff changes sync before the stored kickoff;
            post-kickoff changes need review. Not live scoring —
            cancellations/no-contests may need commissioner action.
          </p>
        </StatusPanel>

        {(reviewItems?.length ?? 0) > 0 ? (
          <StatusPanel title="Schedule changes requiring review" tone="warning">
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {reviewItems!.map((item) => (
                <li key={item.id}>
                  <strong>{item.kind}</strong>: {item.summary}
                </li>
              ))}
            </ul>
          </StatusPanel>
        ) : null}

        {context.season.status === "setup" ? (
          <ActivateSeasonForm
            year={context.season.year}
            canActivate={activationBlock === null && weeks.length >= 18}
            blockedReason={
              activationBlock ??
              (weeks.length < 18
                ? "Sync the NFL schedule so weeks 1–18 exist before activation."
                : null)
            }
          />
        ) : null}

        {current.kind === "actionable" ? (
          <StatusPanel title="Current NFL week (automatic)" tone="success">
            <p>
              {current.week.label} is current based on remaining future
              kickoffs. Picks lock per selected team’s kickoff — not a single
              week deadline.
            </p>
          </StatusPanel>
        ) : (
          <StatusPanel title="No current NFL week" tone="warning">
            <p>
              {current.reason === "no_weeks"
                ? "Sync the NFL schedule to create weeks 1–18."
                : "No week has a future kickoff remaining."}
            </p>
          </StatusPanel>
        )}

        {weeksError ? (
          <StatusPanel title="Could not load weeks" tone="danger">
            <p>{weeksError}</p>
          </StatusPanel>
        ) : null}

        <section className="space-y-2" aria-label="Week summary">
          <h2 className="text-base font-semibold text-stone-900">
            Regular-season week summary
          </h2>
          {weeks.length === 0 ? (
            <p className="text-sm text-stone-600">No weeks yet — run Sync NFL data.</p>
          ) : (
            <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white">
              {weeks.map((week) => {
                const signal = signals.find((s) => s.week_number === week.week_number);
                const isCurrent =
                  current.kind === "actionable" && current.week.id === week.id;
                return (
                  <li key={week.id} className="px-3 py-3 text-sm">
                    <p className="font-medium text-stone-900">
                      Week {week.week_number}
                      {isCurrent ? " · Current" : ""}
                    </p>
                    <p className="text-stone-600">
                      Earliest kickoff (informational):{" "}
                      {formatCentralDateTime(week.locks_at)}
                      {signal
                        ? ` · future kickoffs: ${signal.has_future_kickoff ? "yes" : "no"}`
                        : " · no games yet"}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

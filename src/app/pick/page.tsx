import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PickForm } from "@/app/pick/pick-form";
import { AppShell } from "@/components/app-shell";
import { LeagueContextError } from "@/components/league-context-error";
import { StatusPanel } from "@/components/status-panel";
import { loadLeagueContext } from "@/lib/league/context";
import { usedTeamIds } from "@/lib/picks/used-teams";
import {
  buildPickGameOptions,
  loadRegularWeekSignals,
} from "@/lib/nfl/schedule-query";
import { createClient } from "@/lib/supabase/server";
import { formatCentralDateTime } from "@/lib/time/chicago";
import { resolveCurrentWeekFromGames } from "@/lib/weeks/current-week";
import { loadSeasonWeeks } from "@/lib/weeks/season-weeks";

export const metadata: Metadata = {
  title: "Current Pick | Sunday Survivor Picks",
};

export default async function PickPage() {
  const result = await loadLeagueContext();
  if (!result.ok) {
    if (result.code === "unauthenticated") {
      redirect("/login");
    }
    return (
      <AppShell title="Current Pick">
        <LeagueContextError code={result.code} message={result.message} />
      </AppShell>
    );
  }

  const { context } = result;

  if (context.season.status === "setup") {
    return (
      <AppShell title="Current Pick" subtitle={context.league.name}>
        <StatusPanel title="Season still in setup" tone="warning">
          <p>
            The {context.season.year} season is still in setup. Ask the
            commissioner to activate the season after the NFL schedule is
            synced.
          </p>
        </StatusPanel>
      </AppShell>
    );
  }

  const supabase = await createClient();
  const { weeks, error: weeksError } = await loadSeasonWeeks(
    supabase,
    context.season.id,
  );

  if (weeksError) {
    return (
      <AppShell title="Current Pick">
        <StatusPanel title="Database unavailable" tone="danger">
          <p>Could not load weeks. Try again shortly.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const { signals, error: signalError } = await loadRegularWeekSignals(
    supabase as never,
    context.season.year,
  );
  if (signalError) {
    return (
      <AppShell title="Current Pick">
        <StatusPanel title="Schedule unavailable" tone="danger">
          <p>Could not load NFL schedule signals.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const current = resolveCurrentWeekFromGames(weeks, signals);

  const { data: lastSync } = await supabase
    .from("schedule_sync_runs")
    .select("completed_at, status, source_freshness_at")
    .eq("season_year", context.season.year)
    .eq("status", "succeeded")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (current.kind === "none") {
    return (
      <AppShell title="Current Pick" subtitle={context.league.name}>
        <StatusPanel
          title={
            current.reason === "no_weeks"
              ? "NFL schedule not synced"
              : "No current NFL week"
          }
          tone="warning"
        >
          <p>
            {current.reason === "no_weeks"
              ? "Ask the commissioner to sync the NFL schedule."
              : "There is no remaining regular-season week with a future kickoff."}
          </p>
          {lastSync?.completed_at ? (
            <p className="mt-2 text-sm">
              Last schedule sync: {formatCentralDateTime(lastSync.completed_at)}
            </p>
          ) : null}
        </StatusPanel>
      </AppShell>
    );
  }

  const week = current.week;

  const [{ data: seasonPicks }, { data: games }] = await Promise.all([
    supabase
      .from("picks")
      .select("id, week_id, team_id")
      .eq("user_id", context.userId)
      .in(
        "week_id",
        weeks.map((item) => item.id),
      ),
    supabase
      .from("games")
      .select(
        `
        id,
        home_team_id,
        away_team_id,
        scheduled_kickoff_at,
        status,
        home:teams!games_home_team_id_fkey (id, abbreviation, city, name),
        away:teams!games_away_team_id_fkey (id, abbreviation, city, name)
      `,
      )
      .eq("season_year", context.season.year)
      .eq("season_type", "regular")
      .eq("regular_week_number", week.week_number)
      .neq("status", "canceled"),
  ]);

  const used = usedTeamIds(
    (seasonPicks ?? []).map((pick) => ({
      week_id: pick.week_id,
      team_id: pick.team_id,
    })),
    { excludeWeekId: week.id },
  );

  const gameRows = (games ?? []).map((game) => {
    const home = Array.isArray(game.home) ? game.home[0] : game.home;
    const away = Array.isArray(game.away) ? game.away[0] : game.away;
    return {
      id: game.id as string,
      home_team_id: game.home_team_id as string,
      away_team_id: game.away_team_id as string,
      scheduled_kickoff_at: game.scheduled_kickoff_at as string,
      status: game.status as string,
      home: home as {
        id: string;
        abbreviation: string;
        city: string;
        name: string;
      },
      away: away as {
        id: string;
        abbreviation: string;
        city: string;
        name: string;
      },
    };
  });

  const options = buildPickGameOptions({
    games: gameRows,
    usedTeamIds: used,
  });

  const existingPick =
    (seasonPicks ?? []).find((pick) => pick.week_id === week.id) ?? null;

  const syncLabel = lastSync?.completed_at
    ? formatCentralDateTime(lastSync.completed_at)
    : "never";
  const renderedAtMs = Date.parse(new Date().toISOString());
  const staleSync =
    Boolean(lastSync?.completed_at) &&
    renderedAtMs - new Date(lastSync!.completed_at!).getTime() >
      36 * 60 * 60 * 1000;

  return (
    <AppShell title="Current Pick" subtitle={context.league.name}>
      {staleSync ? (
        <StatusPanel title="Schedule may be stale" tone="warning">
          <p>
            Last successful NFL sync was {syncLabel}. Scores and kickoffs may
            lag; this is not a live scoring feed.
          </p>
        </StatusPanel>
      ) : null}
      <PickForm
        teams={options}
        initialTeamId={existingPick?.team_id ?? null}
        weekLabel={week.label}
        deadlineLabel="Locks at each team’s kickoff (Central Time)"
        locked={options.every((option) => option.locked)}
        lastSyncLabel={syncLabel}
        nowMs={renderedAtMs}
      />
    </AppShell>
  );
}

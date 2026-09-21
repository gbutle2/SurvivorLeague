import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PickForm } from "@/app/pick/pick-form";
import { AppShell } from "@/components/app-shell";
import { LeagueContextError } from "@/components/league-context-error";
import { StatusPanel } from "@/components/status-panel";
import { WeekSelector } from "@/components/week-selector";
import { loadLeagueContext } from "@/lib/league/context";
import { usedTeamIds } from "@/lib/picks/used-teams";
import {
  buildPickGameOptions,
  loadRegularWeekSignals,
} from "@/lib/nfl/schedule-query";
import {
  resolveAuthoritativePickGame,
  resolveExistingPickLockState,
} from "@/lib/picks/eligibility";
import { buildSavedPickSummary } from "@/lib/picks/saved-summary";
import { createClient } from "@/lib/supabase/server";
import { formatCentralDateTime } from "@/lib/time/chicago";
import { resolveCurrentWeekFromGames } from "@/lib/weeks/current-week";
import { loadSeasonWeeks } from "@/lib/weeks/season-weeks";
import {
  buildWeekSelectorOptions,
  parseWeekQueryParam,
  resolveDefaultWeekNumber,
  resolveSelectedWeekNumber,
} from "@/lib/weeks/week-selector";

export const metadata: Metadata = {
  title: "Your Pick | Sunday Survivor Picks",
};

export default async function PickPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
  const result = await loadLeagueContext();
  if (!result.ok) {
    if (result.code === "unauthenticated") {
      redirect("/login");
    }
    return (
      <AppShell title="Your Pick">
        <LeagueContextError code={result.code} message={result.message} />
      </AppShell>
    );
  }

  const { context } = result;

  if (context.season.status === "setup") {
    return (
      <AppShell title="Your Pick" subtitle={context.league.name}>
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
      <AppShell title="Your Pick">
        <StatusPanel title="Database unavailable" tone="danger">
          <p>Could not load weeks. Try again shortly.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const competitionWeeks = weeks.filter(
    (week) => week.week_number <= context.season.regularWeekCount,
  );

  const { signals, error: signalError } = await loadRegularWeekSignals(
    supabase as never,
    context.season.year,
  );
  if (signalError) {
    return (
      <AppShell title="Your Pick">
        <StatusPanel title="Schedule unavailable" tone="danger">
          <p>Could not load NFL schedule signals.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const current = resolveCurrentWeekFromGames(competitionWeeks, signals);
  const effectiveCurrent =
    current.kind === "actionable" ? current.week.week_number : null;
  const options = buildWeekSelectorOptions(
    competitionWeeks,
    signals,
    context.season.regularWeekCount,
    effectiveCurrent,
  );
  const selectedWeekNumber = resolveSelectedWeekNumber(
    parseWeekQueryParam(params.week),
    options.map((option) => option.weekNumber),
    resolveDefaultWeekNumber(competitionWeeks, signals),
  );
  const week =
    competitionWeeks.find((item) => item.week_number === selectedWeekNumber) ??
    null;

  const { data: lastSync } = await supabase
    .from("schedule_sync_runs")
    .select("completed_at, status, source_freshness_at")
    .eq("season_year", context.season.year)
    .eq("status", "succeeded")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!week || options.length === 0) {
    return (
      <AppShell title="Your Pick" subtitle={context.league.name}>
        <StatusPanel title="NFL schedule not synced" tone="warning">
          <p>Ask the commissioner to sync the NFL schedule.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  if (week.status === "locked" || week.status === "final") {
    return (
      <AppShell title="Your Pick" subtitle={context.league.name}>
        <div className="mb-4">
          <WeekSelector
            options={options}
            selectedWeekNumber={week.week_number}
            pathname="/pick"
          />
        </div>
        <StatusPanel title={`${week.label} is ${week.status}`} tone="warning">
          <p>Player picks are read-only for this week.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const signal = signals.find((row) => row.week_number === week.week_number);
  if (!signal) {
    return (
      <AppShell title="Your Pick" subtitle={context.league.name}>
        <div className="mb-4">
          <WeekSelector
            options={options}
            selectedWeekNumber={week.week_number}
            pathname="/pick"
          />
        </div>
        <StatusPanel title="Schedule unavailable" tone="warning">
          <p>
            Schedule data is not available for {week.label} yet. Picks require
            an authoritative matching game.
          </p>
        </StatusPanel>
      </AppShell>
    );
  }

  const [{ data: seasonPicks }, { data: games }] = await Promise.all([
    supabase
      .from("picks")
      .select("id, week_id, team_id, result, game_id")
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

  const existingPick =
    (seasonPicks ?? []).find((pick) => pick.week_id === week.id) ?? null;

  const pickOptions = buildPickGameOptions({
    games: gameRows,
    usedTeamIds: used,
    retainTeamId: existingPick?.team_id ?? null,
  });

  const renderedAtMs = Date.parse(new Date().toISOString());

  const { game: authoritativeGame, unresolved: gameUnresolved } =
    resolveAuthoritativePickGame({
      pick: existingPick
        ? {
            team_id: existingPick.team_id,
            game_id: existingPick.game_id ?? null,
          }
        : null,
      games: gameRows,
    });

  const existingPickState = resolveExistingPickLockState({
    hasExistingPick: Boolean(existingPick),
    weekStatus: week.status,
    authoritativeGame,
    gameUnresolved,
    nowMs: renderedAtMs,
  });

  const fullAuthoritativeGame = authoritativeGame
    ? (gameRows.find((game) => game.id === authoritativeGame.id) ?? null)
    : null;

  const savedSummary = existingPick
    ? buildSavedPickSummary({
        teamId: existingPick.team_id,
        game: fullAuthoritativeGame,
        team: (() => {
          for (const game of gameRows) {
            if (game.home.id === existingPick.team_id) return game.home;
            if (game.away.id === existingPick.team_id) return game.away;
          }
          return null;
        })(),
      })
    : null;

  const syncLabel = lastSync?.completed_at
    ? formatCentralDateTime(lastSync.completed_at)
    : "never";
  const allLocked =
    pickOptions.length === 0 || pickOptions.every((option) => option.locked);

  return (
    <AppShell title="Your Pick" subtitle={context.league.name}>
      <div className="mb-4">
        <WeekSelector
          options={options}
          selectedWeekNumber={week.week_number}
          pathname="/pick"
        />
      </div>
      <PickForm
        key={week.id}
        weekId={week.id}
        weekNumber={week.week_number}
        teams={pickOptions}
        initialTeamId={existingPick?.team_id ?? null}
        weekLabel={week.label}
        existingPickState={existingPickState}
        noEligibleGames={allLocked && !existingPick}
        lastSyncLabel={syncLabel}
        nowMs={renderedAtMs}
        pickResult={existingPick?.result ?? null}
        savedSummary={savedSummary}
      />
    </AppShell>
  );
}

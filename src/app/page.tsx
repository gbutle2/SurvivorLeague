import { redirect } from "next/navigation";

import { AccountMenuHeader } from "@/components/account-menu-header";
import { CommunicationGate } from "@/components/communication/communication-gate";
import { LeagueDashboard } from "@/components/league-dashboard";
import { LeagueContextError } from "@/components/league-context-error";
import { NavCard } from "@/components/nav-card";
import { StatusPanel } from "@/components/status-panel";
import {
  buildRegularStandings,
  resolveStandingsRoundStatus,
  resolveStandingsWeekStatus,
} from "@/lib/dashboard/standings";
import { isCommissioner, loadLeagueContext } from "@/lib/league/context";
import {
  loadPlayoffRoundSignals,
  loadRegularWeekSignals,
} from "@/lib/nfl/schedule-query";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentWeekFromGames } from "@/lib/weeks/current-week";
import { loadSeasonWeeks } from "@/lib/weeks/season-weeks";

export default async function HomePage() {
  const result = await loadLeagueContext();
  if (!result.ok) {
    if (result.code === "unauthenticated") redirect("/login");
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-6 sm:py-8">
        <LeagueContextError code={result.code} message={result.message} />
      </main>
    );
  }

  const { context } = result;
  const supabase = await createClient();
  const { weeks, error: weeksError } = await loadSeasonWeeks(
    supabase,
    context.season.id,
  );
  const competitionWeeks = weeks.filter(
    (week) => week.week_number <= context.season.regularWeekCount,
  );
  const [membersResult, signalsResult, playoffRoundSignalsResult, playoffRoundsResult] =
    await Promise.all([
      supabase
        .from("league_members")
        .select("user_id")
        .eq("league_id", context.league.id)
        .eq("active", true),
      loadRegularWeekSignals(supabase as never, context.season.year),
      loadPlayoffRoundSignals(supabase as never, context.season.year),
      supabase
        .from("playoff_rounds")
        .select("id, round_number, points, status, round_code")
        .eq("season_id", context.season.id),
    ]);

  if (weeksError || membersResult.error || playoffRoundsResult.error) {
    return <DashboardError />;
  }

  const memberIds = (membersResult.data ?? []).map((member) => member.user_id);
  const weekIds = competitionWeeks.map((week) => week.id);
  const playoffRoundIds = (playoffRoundsResult.data ?? []).map((round) => round.id);
  const [profilesResult, picksResult, playoffPicksResult] = await Promise.all([
    memberIds.length
      ? supabase.from("profiles").select("id, display_name").in("id", memberIds)
      : Promise.resolve({ data: [], error: null }),
    weekIds.length
      ? supabase.from("picks").select("user_id, week_id, team_id, result").in("week_id", weekIds)
      : Promise.resolve({ data: [], error: null }),
    playoffRoundIds.length
      ? supabase
          .from("playoff_picks")
          .select("user_id, playoff_round_id, points_awarded, result")
          .in("playoff_round_id", playoffRoundIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesResult.error || picksResult.error || playoffPicksResult.error) {
    return <DashboardError />;
  }

  const scoring = context.scoringRules;
  const playoffMaximum = scoring
    ? scoring.wildcardPoints +
      scoring.divisionalPoints +
      scoring.conferencePoints +
      scoring.superbowlPoints
    : 0;

  const players = (profilesResult.data ?? []).map((profile) => ({
    userId: profile.id,
    displayName: profile.display_name,
  }));
  const signalByWeek = new Map(
    signalsResult.signals.map((signal) => [signal.week_number, signal]),
  );
  const signalByRound = new Map(
    playoffRoundSignalsResult.signals.map((signal) => [signal.round_code, signal]),
  );

  const standings = buildRegularStandings(
    players,
    competitionWeeks.map((week) => {
      const signal = signalByWeek.get(week.week_number);
      return {
        id: week.id,
        weekNumber: week.week_number,
        status: resolveStandingsWeekStatus(week.status, signal),
      };
    }),
    (picksResult.data ?? []).map((pick) => ({
      userId: pick.user_id,
      weekId: pick.week_id,
      result: pick.result,
    })),
    {
      regularPickPoints: scoring?.correctRegularPickPoints ?? 0,
      bestRecordBonus: scoring?.bestRecordBonus ?? 0,
      longestStreakBonus: scoring?.longestStreakBonus ?? 0,
      survivorBonus: scoring?.survivorBonus ?? 0,
      playoffMaximum,
    },
    (playoffRoundsResult.data ?? []).map((round) => ({
      id: round.id,
      roundNumber: round.round_number,
      points: round.points,
      status: resolveStandingsRoundStatus(
        round.status,
        round.round_code
          ? signalByRound.get(round.round_code)
          : undefined,
      ),
    })),
    (playoffPicksResult.data ?? []).map((pick) => ({
      userId: pick.user_id,
      playoffRoundId: pick.playoff_round_id,
      result: pick.result,
      pointsAwarded: pick.points_awarded,
    })),
  );

  const current = resolveCurrentWeekFromGames(
    competitionWeeks,
    signalsResult.signals,
  );
  const currentWeek = current.kind === "actionable" ? current.week : null;
  const currentPicks = currentWeek
    ? (picksResult.data ?? []).filter((pick) => pick.week_id === currentWeek.id)
    : [];
  const currentTeamIds = [...new Set(currentPicks.map((pick) => pick.team_id))];
  const { data: currentTeams, error: teamsError } = currentTeamIds.length
    ? await supabase.from("teams").select("id, abbreviation").in("id", currentTeamIds)
    : { data: [], error: null };
  const teamById = new Map(
    (currentTeams ?? []).map((team) => [team.id, team.abbreviation]),
  );
  const currentPickByUser = new Map(currentPicks.map((pick) => [pick.user_id, pick]));
  const currentSignal = currentWeek
    ? signalByWeek.get(currentWeek.week_number)
    : undefined;
  const weekFinished = currentWeek
    ? resolveStandingsWeekStatus(currentWeek.status, currentSignal) === "final"
    : false;
  const weeklyPicks = currentWeek
    ? players.map((player) => {
        const pick = currentPickByUser.get(player.userId);
        return {
          userId: player.userId,
          displayName: player.displayName,
          team: pick ? (teamById.get(pick.team_id) ?? "Team") : null,
          state: pick
            ? ("visible" as const)
            : player.userId === context.userId || weekFinished
              ? ("missing" as const)
              : ("hidden" as const),
          result: pick?.result ?? null,
        };
      })
    : [];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 sm:py-8">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
            {context.league.name} · {context.season.year}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
            League Dashboard
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Signed in as {context.displayName}
          </p>
        </div>
        <AccountMenuHeader />
      </header>

      {!scoring ? (
        <div className="mb-4">
          <StatusPanel title="Scoring rules missing" tone="warning">
            <p>
              The commissioner must configure scoring before point totals can be
              calculated.
            </p>
          </StatusPanel>
        </div>
      ) : null}
      {teamsError ? (
        <div className="mb-4">
          <StatusPanel title="Team names unavailable" tone="warning">
            <p>
              Weekly picks are visible, but team abbreviations could not be loaded.
            </p>
          </StatusPanel>
        </div>
      ) : null}

      <LeagueDashboard
        currentUserId={context.userId}
        weekNumber={currentWeek?.week_number ?? null}
        weekLabel={currentWeek?.label ?? "No active week"}
        standings={standings}
        weeklyPicks={weeklyPicks}
      />

      <nav className="mt-7 grid gap-3 sm:grid-cols-2" aria-label="League navigation">
        <NavCard
          title="Make pick"
          description="Choose your team for the current NFL week."
          href="/pick"
        />
        <NavCard
          title="Team availability"
          description="See which regular-season teams you can still use."
          href="/availability"
        />
        <NavCard
          title="My history"
          description="Review your prior picks and results."
          href="/history"
        />
        <NavCard
          title="League rules"
          description="See scoring, survivor, playoff, and tiebreak rules."
          href="/rules"
        />
        {isCommissioner(context) ? (
          <NavCard
            title="Commissioner"
            description="Manage members, schedule sync, and exceptional overrides."
            href="/commissioner"
          />
        ) : null}
      </nav>
      <CommunicationGate />
    </main>
  );
}

function DashboardError() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:py-8">
      <StatusPanel title="Dashboard unavailable" tone="danger">
        <p>Could not load the league standings. Try again shortly.</p>
      </StatusPanel>
    </main>
  );
}

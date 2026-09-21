import { redirect } from "next/navigation";

import { PickForm } from "@/app/pick/pick-form";
import { AccountMenuHeader } from "@/components/account-menu-header";
import { CommunicationGate } from "@/components/communication/communication-gate";
import { LeagueDashboard } from "@/components/league-dashboard";
import { LeagueContextError } from "@/components/league-context-error";
import { NavCard } from "@/components/nav-card";
import { StatusPanel } from "@/components/status-panel";
import { WeekSelector } from "@/components/week-selector";
import {
  buildRegularStandings,
  resolveStandingsRoundStatus,
  resolveStandingsWeekStatus,
} from "@/lib/dashboard/standings";
import {
  survivorAliveThroughWeek,
  weeklyPointsForResult,
} from "@/lib/dashboard/week-history";
import { isCommissioner, loadLeagueContext } from "@/lib/league/context";
import { resolveWeeklyPickDisplayState } from "@/lib/dashboard/weekly-pick-status";
import {
  buildPickGameOptions,
  loadPlayoffRoundSignals,
  loadRegularWeekSignals,
} from "@/lib/nfl/schedule-query";
import {
  resolveAuthoritativePickGame,
  resolveExistingPickLockState,
} from "@/lib/picks/eligibility";
import { buildSavedPickSummary } from "@/lib/picks/saved-summary";
import { usedTeamIds } from "@/lib/picks/used-teams";
import { createClient } from "@/lib/supabase/server";
import { formatCentralDateTime } from "@/lib/time/chicago";
import { resolveCurrentWeekFromGames } from "@/lib/weeks/current-week";
import { loadSeasonWeeks } from "@/lib/weeks/season-weeks";
import {
  buildWeekSelectorOptions,
  parseWeekQueryParam,
  resolveDefaultWeekNumber,
  resolveSelectedWeekNumber,
  resolveStandingsCutoffWeekNumber,
  standingsCutoffLabel,
} from "@/lib/weeks/week-selector";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
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
  const [profilesResult, picksResult, playoffPicksResult, ownPicksResult] =
    await Promise.all([
      memberIds.length
        ? supabase.from("profiles").select("id, display_name").in("id", memberIds)
        : Promise.resolve({ data: [], error: null }),
      weekIds.length
        ? supabase
            .from("picks")
            .select("user_id, week_id, team_id, result")
            .in("week_id", weekIds)
        : Promise.resolve({ data: [], error: null }),
      playoffRoundIds.length
        ? supabase
            .from("playoff_picks")
            .select("user_id, playoff_round_id, points_awarded, result")
            .in("playoff_round_id", playoffRoundIds)
        : Promise.resolve({ data: [], error: null }),
      weekIds.length
        ? supabase
            .from("picks")
            .select("id, week_id, team_id, result, game_id")
            .eq("user_id", context.userId)
            .in("week_id", weekIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (
    profilesResult.error ||
    picksResult.error ||
    playoffPicksResult.error ||
    ownPicksResult.error
  ) {
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

  const scoredWeeks = competitionWeeks.map((week) => {
    const signal = signalByWeek.get(week.week_number);
    return {
      id: week.id,
      weekNumber: week.week_number,
      status: resolveStandingsWeekStatus(week.status, signal),
    };
  });

  const current = resolveCurrentWeekFromGames(
    competitionWeeks,
    signalsResult.signals,
  );
  const effectiveCurrentWeekNumber =
    current.kind === "actionable" ? current.week.week_number : null;

  const weekOptions = buildWeekSelectorOptions(
    competitionWeeks,
    signalsResult.signals,
    context.season.regularWeekCount,
    effectiveCurrentWeekNumber,
  );
  const defaultWeek = resolveDefaultWeekNumber(
    competitionWeeks,
    signalsResult.signals,
  );
  const selectedWeekNumber = resolveSelectedWeekNumber(
    parseWeekQueryParam(params.week),
    weekOptions.map((option) => option.weekNumber),
    defaultWeek,
  );
  const selectedWeek =
    competitionWeeks.find((week) => week.week_number === selectedWeekNumber) ??
    null;
  const selectedOption =
    weekOptions.find((option) => option.weekNumber === selectedWeekNumber) ??
    null;

  const cutoffWeekNumber = selectedWeekNumber
    ? resolveStandingsCutoffWeekNumber(selectedWeekNumber, scoredWeeks)
    : null;
  const seasonFullyComplete =
    scoredWeeks.length >= context.season.regularWeekCount &&
    scoredWeeks.every((week) => week.status === "final");

  const standings = buildRegularStandings(
    players,
    scoredWeeks,
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
        round.round_code ? signalByRound.get(round.round_code) : undefined,
      ),
    })),
    (playoffPicksResult.data ?? []).map((pick) => ({
      userId: pick.user_id,
      playoffRoundId: pick.playoff_round_id,
      result: pick.result,
      pointsAwarded: pick.points_awarded,
    })),
    {
      throughWeekNumber: cutoffWeekNumber ?? 0,
      awardSeasonBonuses: Boolean(
        seasonFullyComplete &&
          cutoffWeekNumber != null &&
          cutoffWeekNumber >= context.season.regularWeekCount,
      ),
      includePlayoffs: Boolean(
        seasonFullyComplete &&
          cutoffWeekNumber != null &&
          cutoffWeekNumber >= context.season.regularWeekCount,
      ),
    },
  );

  const selectedPicks = selectedWeek
    ? (picksResult.data ?? []).filter((pick) => pick.week_id === selectedWeek.id)
    : [];
  const selectedTeamIds = [
    ...new Set(
      selectedPicks
        .map((pick) => pick.team_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: selectedTeams, error: teamsError } = selectedTeamIds.length
    ? await supabase
        .from("teams")
        .select("id, abbreviation")
        .in("id", selectedTeamIds)
    : { data: [], error: null };
  const teamById = new Map(
    (selectedTeams ?? []).map((team) => [team.id, team.abbreviation]),
  );
  const pickByUser = new Map(selectedPicks.map((pick) => [pick.user_id, pick]));
  const selectedSignal = selectedWeek
    ? signalByWeek.get(selectedWeek.week_number)
    : undefined;
  const regularPickPoints = scoring?.correctRegularPickPoints ?? 0;

  const submissionStatusResult = selectedWeek
    ? await supabase.rpc("week_pick_submission_status", {
        p_week_id: selectedWeek.id,
      })
    : { data: [] as Array<{
        user_id: string;
        has_pick: boolean;
        currently_commissioner_overridden: boolean;
      }>, error: null };

  const submissionByUser = new Map(
    (submissionStatusResult.data ?? []).map((row) => [
      row.user_id,
      {
        hasPick: Boolean(row.has_pick),
        currentlyCommissionerOverridden: Boolean(
          row.currently_commissioner_overridden,
        ),
      },
    ]),
  );

  const weeklyPicks = selectedWeek
    ? players.map((player) => {
        const pick = pickByUser.get(player.userId);
        const status = submissionByUser.get(player.userId);
        const state = resolveWeeklyPickDisplayState({
          hasVisiblePick: Boolean(pick),
          hasPick: status?.hasPick ?? Boolean(pick),
        });
        return {
          userId: player.userId,
          displayName: player.displayName,
          team: pick ? (teamById.get(pick.team_id) ?? "Team") : null,
          state,
          result: pick?.result ?? null,
          points: weeklyPointsForResult(pick?.result, regularPickPoints),
          survivorAliveAfterWeek: survivorAliveThroughWeek(
            player.userId,
            scoredWeeks,
            (picksResult.data ?? []).map((row) => ({
              userId: row.user_id,
              weekId: row.week_id,
              result: row.result,
            })),
            selectedWeek.week_number,
          ),
          overridden: status?.currentlyCommissionerOverridden ?? false,
        };
      })
    : [];

  // Your Pick controls for the selected week
  const renderedAtMs = Date.parse(new Date().toISOString());
  let yourPickPanel = (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-600 shadow-sm">
      Select a week to manage your pick.
    </div>
  );

  if (selectedWeek && context.season.status !== "setup") {
    const adminLocked =
      selectedWeek.status === "locked" || selectedWeek.status === "final";
    const hasSchedule = Boolean(selectedSignal);

    if (!hasSchedule) {
      yourPickPanel = (
        <PickForm
          key={selectedWeek.id}
          weekId={selectedWeek.id}
          weekNumber={selectedWeek.week_number}
          teams={[]}
          initialTeamId={null}
          weekLabel={selectedWeek.label}
          scheduleUnavailable
          lastSyncLabel="never"
          nowMs={renderedAtMs}
        />
      );
    } else if (adminLocked) {
      const own = (ownPicksResult.data ?? []).find(
        (pick) => pick.week_id === selectedWeek.id,
      );
      yourPickPanel = (
        <StatusPanel title={`${selectedWeek.label} is closed`} tone="warning">
          <p>
            {selectedWeek.label} is closed for picks.
            {own
              ? " Your selection is saved."
              : " You do not have a pick for this week."}
          </p>
        </StatusPanel>
      );
    } else {
      const [{ data: games }, lastSyncResult] = await Promise.all([
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
          .eq("regular_week_number", selectedWeek.week_number)
          .neq("status", "canceled"),
        supabase
          .from("schedule_sync_runs")
          .select("completed_at")
          .eq("season_year", context.season.year)
          .eq("status", "succeeded")
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const used = usedTeamIds(
        (ownPicksResult.data ?? []).map((pick) => ({
          week_id: pick.week_id,
          team_id: pick.team_id,
        })),
        { excludeWeekId: selectedWeek.id },
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
        (ownPicksResult.data ?? []).find(
          (pick) => pick.week_id === selectedWeek.id,
        ) ?? null;

      const options = buildPickGameOptions({
        games: gameRows,
        usedTeamIds: used,
        retainTeamId: existingPick?.team_id ?? null,
      });

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
        weekStatus: selectedWeek.status,
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

      const allLocked = options.length === 0 || options.every((o) => o.locked);
      const syncLabel = lastSyncResult.data?.completed_at
        ? formatCentralDateTime(lastSyncResult.data.completed_at)
        : "never";

      if (options.length === 0 && !existingPick) {
        yourPickPanel = (
          <StatusPanel title="No eligible games" tone="warning">
            <p>
              No pickable games remain for {selectedWeek.label}. Bye weeks and
              kicked-off games are unavailable.
            </p>
          </StatusPanel>
        );
      } else {
        yourPickPanel = (
          <PickForm
            key={selectedWeek.id}
            weekId={selectedWeek.id}
            weekNumber={selectedWeek.week_number}
            teams={options}
            initialTeamId={existingPick?.team_id ?? null}
            weekLabel={selectedWeek.label}
            existingPickState={existingPickState}
            noEligibleGames={allLocked && !existingPick}
            lastSyncLabel={syncLabel}
            nowMs={renderedAtMs}
            pickResult={existingPick?.result ?? null}
            savedSummary={savedSummary}
          />
        );
      }
    }
  }

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
              Weekly picks are visible, but team abbreviations could not be
              loaded.
            </p>
          </StatusPanel>
        </div>
      ) : null}

      <LeagueDashboard
        currentUserId={context.userId}
        weekNumber={selectedWeek?.week_number ?? null}
        weekLabel={
          selectedOption?.optionLabel ?? selectedWeek?.label ?? "No week"
        }
        standingsTitle={standingsCutoffLabel(cutoffWeekNumber)}
        standings={standings}
        weeklyPicks={weeklyPicks}
        weekSelector={
          selectedWeekNumber != null ? (
            <WeekSelector
              options={weekOptions}
              selectedWeekNumber={selectedWeekNumber}
              pathname="/"
            />
          ) : (
            <p className="text-sm text-stone-600">
              No scheduled weeks are available yet.
            </p>
          )
        }
        yourPick={yourPickPanel}
      />

      <nav className="mt-7 grid gap-3 sm:grid-cols-2" aria-label="League navigation">
        <NavCard
          title="Make pick"
          description="Jump to the pick form for the selected week."
          href={
            selectedWeekNumber
              ? `/pick?week=${selectedWeekNumber}`
              : "/pick"
          }
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

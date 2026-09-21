import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { listSeasonWeeks } from "@/app/commissioner/actions";
import {
  loadCommissionerWeekPicks,
  loadWeekTeamOptions,
} from "@/app/commissioner/picks/actions";
import { ManagePicks } from "@/app/commissioner/picks/manage-picks";
import { AppShell } from "@/components/app-shell";
import { LeagueContextError } from "@/components/league-context-error";
import { StatusPanel } from "@/components/status-panel";
import {
  isCommissioner,
  loadLeagueContext,
} from "@/lib/league/context";
import { loadRegularWeekSignals } from "@/lib/nfl/schedule-query";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentWeekFromGames } from "@/lib/weeks/current-week";

export const metadata: Metadata = {
  title: "Manage picks | Sunday Survivor Picks",
};

function weekContextLabel(args: {
  status: string;
  isCurrent: boolean;
  hasFutureKickoff: boolean;
  hasNonTerminal: boolean;
}): string {
  if (args.status === "final") return "Final";
  if (args.isCurrent) return "Current";
  if (args.hasNonTerminal && !args.hasFutureKickoff) return "In progress";
  if (args.status === "upcoming" || !args.hasNonTerminal) return "Upcoming";
  if (args.hasFutureKickoff) return "Current";
  return args.status;
}

export default async function CommissionerManagePicksPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const result = await loadLeagueContext();

  if (!result.ok) {
    if (result.code === "unauthenticated") {
      redirect("/login");
    }
    return (
      <AppShell
        title="Manage picks"
        backHref="/commissioner"
        backLabel="Commissioner"
      >
        <LeagueContextError code={result.code} message={result.message} />
      </AppShell>
    );
  }

  if (!isCommissioner(result.context)) {
    return (
      <AppShell title="Manage picks" backHref="/" backLabel="Home">
        <StatusPanel title="Unauthorized" tone="danger">
          <p>Only the league commissioner can manage picks.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const { context } = result;
  const params = await searchParams;
  const supabase = await createClient();
  const { weeks, error: weeksError } = await listSeasonWeeks(context.season.id);
  const regularWeeks = weeks
    .filter((week) => week.week_number <= context.season.regularWeekCount)
    .sort((a, b) => a.week_number - b.week_number);

  if (weeksError) {
    return (
      <AppShell
        title="Manage picks"
        backHref="/commissioner"
        backLabel="Commissioner"
      >
        <StatusPanel title="Could not load weeks" tone="danger">
          <p>{weeksError}</p>
        </StatusPanel>
      </AppShell>
    );
  }

  if (regularWeeks.length === 0) {
    return (
      <AppShell
        title="Manage picks"
        subtitle={context.league.name}
        backHref="/commissioner"
        backLabel="Commissioner"
      >
        <StatusPanel title="No weeks yet" tone="warning">
          <p>Sync the NFL schedule before managing picks.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const { signals } = await loadRegularWeekSignals(
    supabase as never,
    context.season.year,
  );
  const current = resolveCurrentWeekFromGames(regularWeeks, signals);
  const currentId =
    current.kind === "actionable" ? current.week.id : regularWeeks[0]!.id;

  const selectedWeek =
    regularWeeks.find((week) => week.id === params.week) ??
    regularWeeks.find((week) => week.id === currentId) ??
    regularWeeks[0]!;

  const weekOptions = regularWeeks.map((week) => {
    const signal = signals.find((entry) => entry.week_number === week.week_number);
    const isCurrent =
      current.kind === "actionable" && current.week.id === week.id;
    return {
      id: week.id,
      week_number: week.week_number,
      label: week.label,
      status: week.status,
      contextLabel: weekContextLabel({
        status: week.status,
        isCurrent,
        hasFutureKickoff: Boolean(signal?.has_future_kickoff),
        hasNonTerminal: Boolean(signal?.has_non_terminal_game),
      }),
    };
  });

  let players;
  let teams;
  try {
    [players, teams] = await Promise.all([
      loadCommissionerWeekPicks(selectedWeek.id),
      loadWeekTeamOptions(context.season.year, selectedWeek.week_number),
    ]);
  } catch (error) {
    return (
      <AppShell
        title="Manage picks"
        backHref="/commissioner"
        backLabel="Commissioner"
      >
        <StatusPanel title="Unavailable" tone="danger">
          <p>{error instanceof Error ? error.message : "Could not load picks."}</p>
        </StatusPanel>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Manage picks"
      subtitle={`${context.league.name} · Week ${selectedWeek.week_number}`}
      backHref="/commissioner"
      backLabel="Commissioner"
    >
      <ManagePicks
        weeks={weekOptions}
        selectedWeekId={selectedWeek.id}
        players={players}
        teams={teams}
      />
    </AppShell>
  );
}

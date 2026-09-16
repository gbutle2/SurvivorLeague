import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PickForm } from "@/app/pick/pick-form";
import { AppShell } from "@/components/app-shell";
import { LeagueContextError } from "@/components/league-context-error";
import { StatusPanel } from "@/components/status-panel";
import { loadLeagueContext } from "@/lib/league/context";
import { usedTeamIds } from "@/lib/picks/used-teams";
import { createClient } from "@/lib/supabase/server";
import { formatCentralDateTime, isLockedAt } from "@/lib/time/chicago";
import { resolveOpenWeek } from "@/lib/weeks/open-week";

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
            commissioner to activate the season before picks can be submitted.
          </p>
        </StatusPanel>
      </AppShell>
    );
  }

  const supabase = await createClient();

  const { data: weeks, error: weeksError } = await supabase
    .from("weeks")
    .select("id, week_number, label, locks_at, status")
    .eq("season_id", context.season.id)
    .order("week_number", { ascending: true });

  if (weeksError) {
    return (
      <AppShell title="Current Pick">
        <StatusPanel title="Database unavailable" tone="danger">
          <p>Could not load weeks. Try again shortly.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const open = resolveOpenWeek(weeks ?? []);
  if (open.kind === "none") {
    return (
      <AppShell title="Current Pick" subtitle={context.league.name}>
        <StatusPanel title="No open week" tone="warning">
          <p>There is no regular-season week open for submissions right now.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  if (open.kind === "multiple") {
    return (
      <AppShell title="Current Pick" subtitle={context.league.name}>
        <StatusPanel title="Multiple open weeks" tone="danger">
          <p>
            Configuration error: more than one week is marked open (
            {open.weeks.map((week) => `Week ${week.week_number}`).join(", ")}
            ). Ask the commissioner to close extras before picks continue.
          </p>
        </StatusPanel>
      </AppShell>
    );
  }

  const week = open.week;
  const locked = isLockedAt(week.locks_at);

  const [{ data: teams, error: teamsError }, { data: seasonPicks, error: picksError }] =
    await Promise.all([
      supabase
        .from("teams")
        .select("id, abbreviation, city, name, active")
        .eq("active", true)
        .order("abbreviation", { ascending: true }),
      supabase
        .from("picks")
        .select("id, week_id, team_id")
        .eq("user_id", context.userId)
        .in(
          "week_id",
          (weeks ?? []).map((item) => item.id),
        ),
    ]);

  if (teamsError || picksError) {
    return (
      <AppShell title="Current Pick">
        <StatusPanel title="Database unavailable" tone="danger">
          <p>Could not load teams or your picks.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const currentPick =
    (seasonPicks ?? []).find((pick) => pick.week_id === week.id) ?? null;
  const used = usedTeamIds(seasonPicks ?? [], {
    excludeWeekId: week.id,
  });

  const teamOptions =
    (teams ?? []).map((team) => ({
      id: team.id,
      abbreviation: team.abbreviation,
      city: team.city,
      name: team.name,
      used: used.has(team.id),
    })) ?? [];

  return (
    <AppShell
      title="Current Pick"
      subtitle={`${context.league.name} · ${context.season.year}`}
    >
      <PickForm
        teams={teamOptions}
        initialTeamId={currentPick?.team_id ?? null}
        weekLabel={`Week ${week.week_number}: ${week.label}`}
        deadlineLabel={formatCentralDateTime(week.locks_at)}
        locked={locked}
      />
    </AppShell>
  );
}

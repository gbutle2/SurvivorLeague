import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AvailabilityGrid } from "@/app/availability/availability-grid";
import { AppShell } from "@/components/app-shell";
import { LeagueContextError } from "@/components/league-context-error";
import { StatusPanel } from "@/components/status-panel";
import { loadLeagueContext } from "@/lib/league/context";
import {
  teamAvailabilityStatus,
  usedTeamIds,
} from "@/lib/picks/used-teams";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentWeek } from "@/lib/weeks/current-week";
import { loadSeasonWeeks } from "@/lib/weeks/season-weeks";

export const metadata: Metadata = {
  title: "Team Availability | Sunday Survivor Picks",
};

export default async function AvailabilityPage() {
  const result = await loadLeagueContext();
  if (!result.ok) {
    if (result.code === "unauthenticated") {
      redirect("/login");
    }
    return (
      <AppShell title="Team Availability">
        <LeagueContextError code={result.code} message={result.message} />
      </AppShell>
    );
  }

  const { context } = result;
  const supabase = await createClient();

  const { weeks, error: weeksError } = await loadSeasonWeeks(
    supabase,
    context.season.id,
  );

  if (weeksError) {
    return (
      <AppShell title="Team Availability">
        <StatusPanel title="Database unavailable" tone="danger">
          <p>Could not load weeks for availability.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const weekIds = weeks.map((week) => week.id);
  const current = resolveCurrentWeek(weeks);
  const openWeekId =
    current.kind === "actionable" || current.kind === "open_expired"
      ? current.week.id
      : null;

  const [{ data: teams, error: teamsError }, { data: picks, error: picksError }] =
    await Promise.all([
      supabase
        .from("teams")
        .select("id, abbreviation, city, name")
        .eq("active", true)
        .order("abbreviation", { ascending: true }),
      weekIds.length > 0
        ? supabase
            .from("picks")
            .select("week_id, team_id")
            .eq("user_id", context.userId)
            .in("week_id", weekIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (teamsError || picksError) {
    return (
      <AppShell title="Team Availability">
        <StatusPanel title="Database unavailable" tone="danger">
          <p>Could not load teams or your picks.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const currentTeamId =
    openWeekId == null
      ? null
      : ((picks ?? []).find((pick) => pick.week_id === openWeekId)?.team_id ??
        null);

  const used = usedTeamIds(picks ?? [], { excludeWeekId: openWeekId });

  const availability = (teams ?? []).map((team) => ({
    id: team.id,
    abbreviation: team.abbreviation,
    city: team.city,
    name: team.name,
    status: teamAvailabilityStatus(team.id, used, currentTeamId),
  }));

  return (
    <AppShell
      title="Team Availability"
      subtitle="Your regular-season teams only — other players’ picks stay hidden until lock."
    >
      {current.kind === "multiple_open" ? (
        <div className="mb-3">
          <StatusPanel title="Multiple open weeks" tone="danger">
            <p>
              Week configuration is invalid. Availability still shows your used
              teams, but current-week highlighting may be incomplete.
            </p>
          </StatusPanel>
        </div>
      ) : null}
      <AvailabilityGrid teams={availability} />
    </AppShell>
  );
}

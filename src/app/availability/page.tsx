import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AvailabilityGrid } from "@/app/availability/availability-grid";
import { AvailabilityMemberSelector } from "@/app/availability/member-selector";
import { AppShell } from "@/components/app-shell";
import { LeagueContextError } from "@/components/league-context-error";
import { StatusPanel } from "@/components/status-panel";
import { buildAvailabilityGrid } from "@/lib/availability/build-grid";
import {
  buildAvailabilityMemberOptions,
  resolveAvailabilityMemberId,
  selectedMemberHeading,
} from "@/lib/availability/member-options";
import { loadLeagueContext } from "@/lib/league/context";
import { loadRegularWeekSignals } from "@/lib/nfl/schedule-query";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentWeekFromGames } from "@/lib/weeks/current-week";
import { loadSeasonWeeks } from "@/lib/weeks/season-weeks";

export const metadata: Metadata = {
  title: "Team Availability | Sunday Survivor Picks",
};

type AvailabilityPageProps = {
  searchParams: Promise<{ member?: string }>;
};

export default async function AvailabilityPage({
  searchParams,
}: AvailabilityPageProps) {
  const params = await searchParams;
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
  const { signals } = await loadRegularWeekSignals(
    supabase as never,
    context.season.year,
  );
  const current = resolveCurrentWeekFromGames(weeks, signals);
  const openWeekId =
    current.kind === "actionable" ? current.week.id : null;

  const [
    { data: teams, error: teamsError },
    { data: memberRows, error: membersError },
  ] = await Promise.all([
    supabase
      .from("teams")
      .select("id, abbreviation, city, name")
      .eq("active", true)
      .order("abbreviation", { ascending: true }),
    supabase
      .from("league_members")
      .select("user_id")
      .eq("league_id", context.league.id)
      .eq("active", true),
  ]);

  if (teamsError || membersError) {
    return (
      <AppShell title="Team Availability">
        <StatusPanel title="Database unavailable" tone="danger">
          <p>Could not load teams or league members.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const memberIds = (memberRows ?? []).map((row) => row.user_id);
  const { data: profiles, error: profilesError } = memberIds.length
    ? await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", memberIds)
    : { data: [], error: null };

  if (profilesError) {
    return (
      <AppShell title="Team Availability">
        <StatusPanel title="Database unavailable" tone="danger">
          <p>Could not load league member names.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const activeMemberIds = new Set(memberIds);
  const selectedMemberId = resolveAvailabilityMemberId({
    viewerId: context.userId,
    requestedId: params.member,
    activeMemberIds,
  });

  // Query only the selected member's picks. RLS hides unstarted peers' picks.
  const { data: visiblePicks, error: picksError } =
    weekIds.length > 0
      ? await supabase
          .from("picks")
          .select("week_id, team_id")
          .eq("user_id", selectedMemberId)
          .in("week_id", weekIds)
      : { data: [], error: null };

  if (picksError) {
    return (
      <AppShell title="Team Availability">
        <StatusPanel title="Database unavailable" tone="danger">
          <p>Could not load team availability.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const memberOptions = buildAvailabilityMemberOptions({
    viewerId: context.userId,
    members: (profiles ?? []).map((profile) => ({
      userId: profile.id,
      displayName: profile.display_name,
    })),
  });

  const heading = selectedMemberHeading(
    memberOptions,
    selectedMemberId,
    context.userId,
  );

  const availability = buildAvailabilityGrid({
    teams: teams ?? [],
    visiblePicks: visiblePicks ?? [],
    currentWeekId: openWeekId,
  });

  return (
    <AppShell
      title="Team Availability"
      subtitle={`${heading} — other players’ unstarted picks stay hidden until kickoff.`}
    >
      {current.kind === "actionable" &&
      current.multipleOpenWarning.length > 1 ? (
        <div className="mb-3">
          <StatusPanel title="Commissioner notice" tone="warning">
            <p>
              Multiple weeks are stored as open. Current-week highlighting uses
              Week {current.week.week_number} (earliest eligible).
            </p>
          </StatusPanel>
        </div>
      ) : null}
      <AvailabilityMemberSelector
        members={memberOptions}
        selectedId={selectedMemberId}
      />
      <p className="mb-3 text-sm font-medium text-stone-800">{heading}</p>
      <AvailabilityGrid teams={availability} />
    </AppShell>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { LeagueContextError } from "@/components/league-context-error";
import { StatusPanel } from "@/components/status-panel";
import { loadLeagueContext } from "@/lib/league/context";
import { createClient } from "@/lib/supabase/server";
import { formatCentralDateTime, isLockedAt } from "@/lib/time/chicago";

export const metadata: Metadata = {
  title: "Pick History | Sunday Survivor Picks",
};

export default async function HistoryPage() {
  const result = await loadLeagueContext();
  if (!result.ok) {
    if (result.code === "unauthenticated") {
      redirect("/login");
    }
    return (
      <AppShell title="Pick History">
        <LeagueContextError code={result.code} message={result.message} />
      </AppShell>
    );
  }

  const { context } = result;
  const supabase = await createClient();

  const { data: weeks, error: weeksError } = await supabase
    .from("weeks")
    .select("id, week_number, label, locks_at, status")
    .eq("season_id", context.season.id)
    .order("week_number", { ascending: true });

  if (weeksError) {
    return (
      <AppShell title="Pick History">
        <StatusPanel title="Database unavailable" tone="danger">
          <p>Could not load weeks.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const weekRows = weeks ?? [];
  const weekIds = weekRows.map((week) => week.id);

  const { data: picks, error: picksError } =
    weekIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("picks")
          .select("id, week_id, team_id, result, submitted_at, updated_at")
          .eq("user_id", context.userId)
          .in("week_id", weekIds);

  if (picksError) {
    return (
      <AppShell title="Pick History">
        <StatusPanel title="Database unavailable" tone="danger">
          <p>Could not load your picks.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const teamIds = [...new Set((picks ?? []).map((pick) => pick.team_id))];
  const { data: teams, error: teamsError } =
    teamIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("teams")
          .select("id, abbreviation, city, name")
          .in("id", teamIds);

  if (teamsError) {
    return (
      <AppShell title="Pick History">
        <StatusPanel title="Database unavailable" tone="danger">
          <p>Could not load team details for your picks.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const teamById = new Map((teams ?? []).map((team) => [team.id, team]));
  const pickByWeek = new Map((picks ?? []).map((pick) => [pick.week_id, pick]));

  return (
    <AppShell
      title="Pick History"
      subtitle={`${context.league.name} · ${context.season.year} regular season`}
    >
      {weekRows.length === 0 ? (
        <StatusPanel title="No weeks yet" tone="neutral">
          <p>History will appear after the commissioner creates weeks.</p>
        </StatusPanel>
      ) : (
        <ul className="space-y-3">
          {weekRows.map((week) => {
            const pick = pickByWeek.get(week.id) ?? null;
            const team = pick ? (teamById.get(pick.team_id) ?? null) : null;
            const locked = isLockedAt(week.locks_at);
            const stateLabel = locked
              ? "Locked"
              : week.status === "open"
                ? "Open"
                : week.status;

            return (
              <li
                key={week.id}
                className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-stone-900">
                      Week {week.week_number}
                    </h2>
                    <p className="text-sm text-stone-600">{week.label}</p>
                  </div>
                  <span
                    className={[
                      "rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide",
                      locked
                        ? "bg-amber-100 text-amber-950"
                        : "bg-emerald-100 text-emerald-900",
                    ].join(" ")}
                  >
                    {stateLabel}
                  </span>
                </div>

                {pick && team ? (
                  <>
                    <p className="mt-3 text-base font-semibold text-stone-900">
                      {team.city} {team.name}{" "}
                      <span className="text-stone-500">({team.abbreviation})</span>
                    </p>
                    <p className="mt-1 text-sm capitalize text-stone-700">
                      Result: {pick.result}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-stone-500">
                      Submitted {formatCentralDateTime(pick.submitted_at)}
                      {pick.updated_at !== pick.submitted_at
                        ? ` · Updated ${formatCentralDateTime(pick.updated_at)}`
                        : ""}
                    </p>
                  </>
                ) : (
                  <p className="mt-3 text-sm font-medium text-stone-700">
                    No pick submitted
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}

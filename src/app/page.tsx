import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";
import { NavCard } from "@/components/nav-card";
import { StatusPanel } from "@/components/status-panel";
import {
  isCommissioner,
  loadLeagueContext,
} from "@/lib/league/context";
import { loadRegularWeekSignals } from "@/lib/nfl/schedule-query";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentWeekFromGames } from "@/lib/weeks/current-week";
import { loadSeasonWeeks } from "@/lib/weeks/season-weeks";

export default async function HomePage() {
  const result = await loadLeagueContext();

  if (!result.ok) {
    if (result.code === "unauthenticated") {
      redirect("/login");
    }

    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-6 sm:py-8">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
              Private league
            </p>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
              Sunday Survivor Picks
            </h1>
          </div>
          <LogoutButton />
        </header>
        <StatusPanel
          title={
            result.code === "no_membership"
              ? "No active membership"
              : result.code === "no_season"
                ? "Season still in setup"
                : result.code === "database_error"
                  ? "Database unavailable"
                  : "League configuration issue"
          }
          tone={
            result.code === "database_error" ||
            result.code === "multiple_memberships" ||
            result.code === "multiple_seasons"
              ? "danger"
              : "warning"
          }
        >
          <p>{result.message}</p>
        </StatusPanel>
      </main>
    );
  }

  const { context } = result;
  const commissioner = isCommissioner(context);
  const supabase = await createClient();
  const { weeks } = await loadSeasonWeeks(supabase, context.season.id);
  const { signals } = await loadRegularWeekSignals(
    supabase as never,
    context.season.year,
  );
  const current = resolveCurrentWeekFromGames(weeks, signals);

  let weekSummary = "NFL schedule not synced yet.";
  if (current.kind === "actionable") {
    weekSummary = `Current NFL week: Week ${current.week.week_number} (locks at each team’s kickoff).`;
  } else if (current.kind === "none") {
    weekSummary =
      current.reason === "no_weeks"
        ? "NFL schedule not synced yet."
        : "No remaining NFL week with a future kickoff.";
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 sm:py-8">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
            Private league
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
            Sunday Survivor Picks
          </h1>
        </div>
        <LogoutButton />
      </header>

      <section className="mb-6 rounded-2xl border border-emerald-900/10 bg-emerald-950 p-4 text-emerald-50 shadow-sm">
        <p className="text-sm text-emerald-100/80">Signed in as</p>
        <p className="mt-1 text-lg font-semibold">
          {context.displayName}
        </p>
        <p className="mt-3 text-sm text-emerald-100/90">{weekSummary}</p>
      </section>

      <nav className="grid gap-3" aria-label="League navigation">
        <NavCard
          title="Make pick"
          description="Choose a team playing this NFL week. Locks at that team’s kickoff."
          href="/pick"
        />
        <NavCard
          title="Team availability"
          description="See which teams you’ve already used."
          href="/availability"
        />
        <NavCard
          title="History"
          description="Review prior weeks and results."
          href="/history"
        />
        {commissioner ? (
          <NavCard
            title="Commissioner"
            description="Sync NFL schedule/results and manage exceptional overrides."
            href="/commissioner"
          />
        ) : null}
      </nav>
    </main>
  );
}

import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";
import { NavCard } from "@/components/nav-card";
import { StatusPanel } from "@/components/status-panel";
import {
  isCommissioner,
  loadLeagueContext,
} from "@/lib/league/context";

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
        <p className="mt-0.5 text-lg font-semibold tracking-tight">
          {context.displayName}
        </p>
        {context.email ? (
          <p className="mt-0.5 truncate text-sm text-emerald-100/70">
            {context.email}
          </p>
        ) : null}
        <p className="mt-3 text-sm text-emerald-50/90">
          {context.league.name} · {context.season.year} ({context.season.status})
        </p>
      </section>

      <nav className="grid gap-3" aria-label="League sections">
        <NavCard
          title="Current Pick"
          description="Submit or change this week’s survivor pick before the Central Time deadline."
          href="/pick"
        />
        <NavCard
          title="Standings"
          description="Season points, streaks, and survivor status will appear here."
          badge="Upcoming"
        />
        <NavCard
          title="Team Availability"
          description="See which NFL teams you still have available to pick."
          href="/availability"
        />
        <NavCard
          title="Pick History"
          description="Your weekly picks and results across the season."
          href="/history"
        />
        <NavCard
          title="Rules"
          description="Scoring, bonuses, and playoff point values for the active season."
          badge="Upcoming"
        />
        {commissioner ? (
          <NavCard
            title="Commissioner"
            description="Create and manage regular-season weeks, lock times, and open/closed status."
            href="/commissioner"
          />
        ) : null}
      </nav>
    </main>
  );
}

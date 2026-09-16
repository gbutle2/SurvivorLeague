import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";
import { PlaceholderCard } from "@/components/placeholder-card";
import { getSessionPlayer } from "@/lib/auth/session";

export default async function HomePage() {
  const player = await getSessionPlayer();

  if (!player) {
    redirect("/login");
  }

  const connectionLabel =
    player.connectionStatus === "connected"
      ? "Connected to Supabase"
      : "Session active — database check incomplete";

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

      <section className="mb-6 rounded-2xl border border-emerald-900/10 bg-emerald-950 text-emerald-50 p-4 shadow-sm">
        <p className="text-sm text-emerald-100/80">Signed in as</p>
        <p className="mt-0.5 text-lg font-semibold tracking-tight">
          {player.displayName}
        </p>
        {player.email ? (
          <p className="mt-0.5 truncate text-sm text-emerald-100/70">
            {player.email}
          </p>
        ) : null}
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              player.connectionStatus === "connected"
                ? "bg-lime-400"
                : "bg-amber-400"
            }`}
            aria-hidden
          />
          <span className="text-emerald-50/90">{connectionLabel}</span>
        </div>
      </section>

      <nav className="grid gap-3" aria-label="League sections">
        <PlaceholderCard
          title="Current Pick"
          description="Submit and review this week’s survivor pick once weeks are configured."
        />
        <PlaceholderCard
          title="Standings"
          description="Season points, streaks, and survivor status will appear here."
        />
        <PlaceholderCard
          title="Team Availability"
          description="See which NFL teams you still have available to pick."
        />
        <PlaceholderCard
          title="Pick History"
          description="Your weekly picks and results across the season."
        />
        <PlaceholderCard
          title="Rules"
          description="Scoring, bonuses, and playoff point values for the active season."
        />
        {player.isCommissioner ? (
          <PlaceholderCard
            title="Commissioner"
            description="Manage seasons, weeks, members, results, and scoring rules."
          />
        ) : null}
      </nav>
    </main>
  );
}

import Link from "next/link";

import type { Standing } from "@/lib/dashboard/standings";

type WeeklyPick = {
  userId: string;
  displayName: string;
  team: string | null;
  state: "visible" | "hidden" | "missing";
  result: string | null;
};

type LeagueDashboardProps = {
  currentUserId: string;
  weekNumber: number | null;
  weekLabel: string;
  standings: Standing[];
  weeklyPicks: WeeklyPick[];
};

export function LeagueDashboard({
  currentUserId,
  weekNumber,
  weekLabel,
  standings,
  weeklyPicks,
}: LeagueDashboardProps) {
  const leader = standings[0] ?? null;
  const alive = standings.filter((standing) => standing.survivorAlive).length;

  return (
    <>
      <section className="grid grid-cols-3 gap-2" aria-label="League summary">
        <div className="rounded-2xl border border-emerald-900/10 bg-emerald-950 p-3 text-emerald-50 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-100/70">Leader</p>
          <p className="mt-1 truncate text-base font-bold">{leader?.displayName ?? "—"}</p>
          <p className="text-xs text-emerald-100/80">{leader?.pointsEarned ?? 0} pts</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Survivors</p>
          <p className="mt-1 text-xl font-bold text-stone-900">{alive}</p>
          <p className="text-xs text-stone-500">of {standings.length}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Week</p>
          <p className="mt-1 text-xl font-bold text-stone-900">{weekNumber ?? "—"}</p>
          <p className="truncate text-xs text-stone-500">{weekLabel}</p>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Competition</p>
            <h2 className="font-display text-xl font-bold text-stone-900">League standings</h2>
          </div>
          <Link href="/rules" className="min-h-11 py-3 text-sm font-semibold text-emerald-900 underline-offset-2 hover:underline">Scoring rules</Link>
        </div>

        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <ol className="divide-y divide-stone-100 sm:hidden">
            {standings.map((standing, index) => (
              <li key={standing.userId} className={standing.userId === currentUserId ? "bg-emerald-50/70 p-4" : "p-4"}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-stone-400">#{index + 1}</p>
                    <p className="mt-0.5 font-semibold text-stone-900">{standing.displayName}{standing.userId === currentUserId ? <span className="ml-1 text-xs font-medium text-emerald-800">You</span> : null}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold tabular-nums text-stone-900">{standing.pointsEarned}</p>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">points</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  <MobileStat label="Record" value={`${standing.wins}-${standing.losses}${standing.ties ? `-${standing.ties}` : ""}`} />
                  <MobileStat label="Streak" value={String(standing.longestStreak)} />
                  <MobileStat label="Survivor" value={standing.survivorAlive ? "Alive" : "Out"} accent={standing.survivorAlive} />
                  <MobileStat label="Max" value={String(standing.maxPossible)} />
                </div>
              </li>
            ))}
          </ol>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-3 font-semibold">Rank</th>
                  <th className="px-3 py-3 font-semibold">Player</th>
                  <th className="px-3 py-3 text-center font-semibold">Record</th>
                  <th className="px-3 py-3 text-center font-semibold">Best streak</th>
                  <th className="px-3 py-3 text-center font-semibold">Survivor</th>
                  <th className="px-3 py-3 text-right font-semibold">Earned</th>
                  <th className="px-3 py-3 text-right font-semibold">Max possible</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {standings.map((standing, index) => (
                  <tr key={standing.userId} className={standing.userId === currentUserId ? "bg-emerald-50/70" : undefined}>
                    <td className="px-3 py-3 font-bold text-stone-500">{index + 1}</td>
                    <td className="px-3 py-3 font-semibold text-stone-900">
                      {standing.displayName}
                      {standing.userId === currentUserId ? <span className="ml-1 text-xs font-medium text-emerald-800">You</span> : null}
                    </td>
                    <td className="px-3 py-3 text-center tabular-nums text-stone-700">{standing.wins}-{standing.losses}{standing.ties ? `-${standing.ties}` : ""}</td>
                    <td className="px-3 py-3 text-center tabular-nums text-stone-700">{standing.longestStreak}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={standing.survivorAlive ? "rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-900" : "rounded-full bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-500"}>
                        {standing.survivorAlive ? "Alive" : "Out"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums text-stone-900">{standing.pointsEarned}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-stone-600">{standing.maxPossible}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-stone-100 px-3 py-2 text-xs leading-relaxed text-stone-500">
            Earned excludes unsettled season bonuses. Max possible is a ceiling: earned points plus every unresolved point the player could still earn.
          </p>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">This week</p>
          <h2 className="font-display text-xl font-bold text-stone-900">Weekly picks</h2>
        </div>
        {weeklyPicks.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-600 shadow-sm">No current week is available.</div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {weeklyPicks.map((pick) => (
              <li key={pick.userId} className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
                <div>
                  <p className="font-semibold text-stone-900">{pick.displayName}{pick.userId === currentUserId ? <span className="ml-1 text-xs font-medium text-emerald-800">You</span> : null}</p>
                  {pick.result && pick.result !== "pending" ? <p className="mt-0.5 text-xs capitalize text-stone-500">{pick.result}</p> : null}
                </div>
                <p className={pick.state === "visible" ? "font-bold text-stone-900" : pick.state === "missing" ? "text-sm font-semibold text-rose-700" : "text-sm font-semibold text-stone-400"}>
                  {pick.state === "visible" ? pick.team : pick.state === "missing" ? "No pick" : "Hidden"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function MobileStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-stone-50 px-1 py-2">
      <p className={accent ? "text-sm font-bold text-emerald-800" : "text-sm font-bold text-stone-800"}>{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">{label}</p>
    </div>
  );
}

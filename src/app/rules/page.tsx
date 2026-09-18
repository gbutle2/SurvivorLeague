import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { LeagueContextError } from "@/components/league-context-error";
import { StatusPanel } from "@/components/status-panel";
import { loadLeagueContext } from "@/lib/league/context";

export const metadata: Metadata = { title: "League Rules | Sunday Survivor Picks" };

export default async function RulesPage() {
  const result = await loadLeagueContext();
  if (!result.ok) {
    if (result.code === "unauthenticated") redirect("/login");
    return <AppShell title="League Rules"><LeagueContextError code={result.code} message={result.message} /></AppShell>;
  }

  const { context } = result;
  const rules = context.scoringRules;
  if (!rules) {
    return <AppShell title="League Rules" subtitle={`${context.league.name} · ${context.season.year}`}><StatusPanel title="Scoring rules missing" tone="warning"><p>The commissioner has not configured this season’s scoring rules.</p></StatusPanel></AppShell>;
  }

  const playoffMaximum = rules.wildcardPoints + rules.divisionalPoints + rules.conferencePoints + rules.superbowlPoints;
  return (
    <AppShell title="League Rules" subtitle={`${context.league.name} · ${context.season.year} season`}>
      <div className="space-y-4">
        <RuleSection title="Regular season">
          <RuleRow label="Schedule" value={`${context.season.regularWeekCount} weekly picks`} />
          <RuleRow label="Correct pick" value={`${rules.correctRegularPickPoints} point${rules.correctRegularPickPoints === 1 ? "" : "s"}`} />
          <RuleRow label="Team use" value="Each NFL team may be used once" />
          <RuleRow label="Loss or tie" value="0 points" />
          <RuleRow label="Missed pick" value="0 points and survivor elimination" />
          <RuleRow label="After elimination" value="Keep making weekly picks for points" />
        </RuleSection>
        <RuleSection title="Season bonuses">
          <RuleRow label="Best record" value={`${rules.bestRecordBonus} points`} />
          <RuleRow label="Longest winning streak" value={`${rules.longestStreakBonus} points`} />
          <RuleRow label="Regular survivor winner" value={`${rules.survivorBonus} points`} />
          <RuleRow label="Tied leaders" value="Each tied leader receives the full bonus" />
        </RuleSection>
        <RuleSection title="Regular survivor resolution">
          <RuleRow label="Ends early" value="As soon as exactly one player remains alive" />
          <RuleRow label="Early winner" value="Keeps the survivor bonus even after later weekly losses" />
          <RuleRow label="Same-week wipeout" value="All players eliminated that week tie and each receive the full bonus" />
          <RuleRow label="Season-long survivors" value="Everyone still alive after the final regular week ties for the full bonus" />
          <RuleRow label="Elimination" value="Loss, tie, or missed pick; pending picks never eliminate" />
        </RuleSection>
        <RuleSection title="Playoff survivor">
          <RuleRow label="Team use" value="Fresh used-team list for the playoffs" />
          <RuleRow label="Wildcard" value={`${rules.wildcardPoints} points`} />
          <RuleRow label="Divisional" value={`${rules.divisionalPoints} points`} />
          <RuleRow label="Conference" value={`${rules.conferencePoints} points`} />
          <RuleRow label="Super Bowl" value={`${rules.superbowlPoints} points`} />
          <RuleRow label="Maximum" value={`${playoffMaximum} points`} />
          <RuleRow label="Missed round" value="No pick in a completed playoff round eliminates from playoff survivor" />
        </RuleSection>
        <RuleSection title="Winner and pick visibility">
          <RuleRow label="Perfect season" value={rules.perfectSeasonOverride ? `${context.season.regularWeekCount}-0 automatically wins overall` : "No automatic-win override"} />
          {rules.perfectSeasonOverride ? <RuleRow label="Multiple perfect seasons" value="Playoff survivor is the tiebreak" /> : null}
          <RuleRow label="Pick lock" value="Each pick locks at that team’s scheduled kickoff" />
          <RuleRow label="Other players’ picks" value="Hidden until the selected team’s kickoff" />
          <RuleRow label="League timezone" value="Central Time" />
        </RuleSection>
        <p className="px-1 text-xs leading-relaxed text-stone-500">Cancellations, postponements, and an exhausted playoff tiebreak require a commissioner ruling because those cases are not yet defined.</p>
      </div>
    </AppShell>
  );
}

function RuleSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"><h2 className="border-b border-stone-100 bg-stone-50 px-4 py-3 font-display text-lg font-bold text-stone-900">{title}</h2><dl className="divide-y divide-stone-100">{children}</dl></section>;
}

function RuleRow({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-4"><dt className="text-sm font-semibold text-stone-900">{label}</dt><dd className="text-sm leading-relaxed text-stone-600 sm:text-right">{value}</dd></div>;
}


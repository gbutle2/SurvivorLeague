import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MembersManager } from "@/app/commissioner/members/members-manager";
import { loadMembersForPage } from "@/app/commissioner/members/actions";
import { AppShell } from "@/components/app-shell";
import { LeagueContextError } from "@/components/league-context-error";
import { StatusPanel } from "@/components/status-panel";
import { MAX_ACTIVE_LEAGUE_MEMBERS } from "@/lib/members/validation";
import {
  isCommissioner,
  loadLeagueContext,
} from "@/lib/league/context";
import { mapMemberErrorForUi } from "@/lib/members/validation";

export const metadata: Metadata = {
  title: "Members | Sunday Survivor Picks",
};

export default async function CommissionerMembersPage() {
  const result = await loadLeagueContext();

  if (!result.ok) {
    if (result.code === "unauthenticated") {
      redirect("/login");
    }
    return (
      <AppShell title="Members" backHref="/commissioner" backLabel="Commissioner">
        <LeagueContextError code={result.code} message={result.message} />
      </AppShell>
    );
  }

  if (!isCommissioner(result.context)) {
    return (
      <AppShell title="Members" backHref="/" backLabel="Home">
        <StatusPanel title="Unauthorized" tone="danger">
          <p>Only the league commissioner can manage members.</p>
        </StatusPanel>
      </AppShell>
    );
  }

  let members;
  try {
    members = await loadMembersForPage();
  } catch (error) {
    return (
      <AppShell
        title="Members"
        backHref="/commissioner"
        backLabel="Commissioner"
        subtitle={result.context.league.name}
      >
        <StatusPanel title="Unavailable" tone="danger">
          <p>{mapMemberErrorForUi(error)}</p>
        </StatusPanel>
      </AppShell>
    );
  }

  const activeCount = members.filter((member) => member.active).length;

  return (
    <AppShell
      title="Members"
      subtitle={`${result.context.league.name} · ${activeCount}/${MAX_ACTIVE_LEAGUE_MEMBERS} active`}
      backHref="/commissioner"
      backLabel="Commissioner"
    >
      <MembersManager
        members={members}
        activeCount={activeCount}
        maxActive={MAX_ACTIVE_LEAGUE_MEMBERS}
      />
    </AppShell>
  );
}

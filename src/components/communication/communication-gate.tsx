import { CommunicationHost } from "@/components/communication/communication-host";
import { loadLeagueContext } from "@/lib/league/context";

/**
 * Loads league membership and renders the floating communication trigger
 * only when the signed-in user has a resolvable active league.
 */
export async function CommunicationGate() {
  const result = await loadLeagueContext();
  if (!result.ok) return null;

  return (
    <CommunicationHost
      leagueId={result.context.league.id}
      userId={result.context.userId}
    />
  );
}

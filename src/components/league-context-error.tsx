import Link from "next/link";

import { StatusPanel } from "@/components/status-panel";
import type { LeagueContextErrorCode } from "@/lib/league/context";

const titles: Record<LeagueContextErrorCode, string> = {
  unauthenticated: "Sign in required",
  no_membership: "No active league membership",
  multiple_memberships: "Multiple league memberships",
  no_season: "Season not ready",
  multiple_seasons: "Season configuration error",
  database_error: "Database unavailable",
};

export function LeagueContextError({
  code,
  message,
}: {
  code: LeagueContextErrorCode;
  message: string;
}) {
  const tone =
    code === "database_error" || code === "multiple_memberships" || code === "multiple_seasons"
      ? "danger"
      : code === "no_membership" || code === "no_season"
        ? "warning"
        : "neutral";

  return (
    <StatusPanel title={titles[code]} tone={tone}>
      <p>{message}</p>
      {code === "unauthenticated" ? (
        <p className="mt-3">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center font-semibold text-emerald-900 underline"
          >
            Go to sign in
          </Link>
        </p>
      ) : (
        <p className="mt-3">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center font-semibold text-emerald-900 underline"
          >
            Back to home
          </Link>
        </p>
      )}
    </StatusPanel>
  );
}

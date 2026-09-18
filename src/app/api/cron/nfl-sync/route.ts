import { NextResponse } from "next/server";

import { withSyncClient } from "@/lib/nfl/db";
import { syncNflSchedule } from "@/lib/nfl/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret =
    process.env.SCHEDULE_SYNC_SECRET ?? process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

async function runSync(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secFetchDest = request.headers.get("sec-fetch-dest");
  if (secFetchDest === "document") {
    return NextResponse.json(
      { error: "Browser navigation rejected" },
      { status: 403 },
    );
  }

  let seasonYear = Number(
    process.env.NFL_SYNC_SEASON_YEAR ?? new Date().getUTCFullYear(),
  );
  if (request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      seasonYear?: number;
    };
    if (typeof body.seasonYear === "number") {
      seasonYear = body.seasonYear;
    }
  }

  if (!Number.isInteger(seasonYear) || seasonYear < 2000) {
    return NextResponse.json({ error: "Invalid seasonYear" }, { status: 400 });
  }

  const result = await withSyncClient((client) =>
    syncNflSchedule(client, { seasonYear }),
  );

  return NextResponse.json({
    provider: "nflverse",
    seasonYear,
    liveScoring: false,
    note: "nflverse schedules are not a live scoring feed; daily refresh only on Hobby.",
    ...result,
  });
}

/** Vercel Cron (Hobby: once daily) invokes GET with CRON_SECRET bearer. */
export async function GET(request: Request) {
  return runSync(request);
}

export async function POST(request: Request) {
  return runSync(request);
}

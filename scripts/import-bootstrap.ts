#!/usr/bin/env node
/**
 * Admin-only league bootstrap import.
 *
 * Reads reviewed workbook-derived JSON (never parses .xlsx in the app).
 * Credentials: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY only (never
 * NEXT_PUBLIC_*, never commit secrets).
 *
 * Default: --dry-run (no writes). Use --apply only after explicit approval.
 * Phase 2B-A must not run this against production.
 *
 * Usage:
 *   npm run import:bootstrap -- --file path/to/bootstrap.json
 *   npm run import:bootstrap -- --file path/to/bootstrap.json --apply
 *   npm run import:bootstrap -- --file path/to/bootstrap.json --apply --allow-overwrite
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  planBootstrapImport,
  type ExistingBootstrapSnapshot,
} from "../src/lib/import/bootstrap-plan.ts";
import {
  validateBootstrapDocument,
  type BootstrapImportDocument,
} from "../src/lib/import/bootstrap-schema.ts";

type AdminClient = SupabaseClient;

function parseArgs(argv: string[]) {
  let file: string | null = null;
  let apply = false;
  let allowOverwrite = false;
  let dryRun = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") {
      file = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--apply") {
      apply = true;
      dryRun = false;
    } else if (arg === "--dry-run") {
      dryRun = true;
      apply = false;
    } else if (arg === "--allow-overwrite") {
      allowOverwrite = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return { file, apply, allowOverwrite, dryRun };
}

function printHelp() {
  console.log(`League bootstrap import (admin script)

Required env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Options:
  --file <path>          Reviewed JSON import document
  --dry-run              Plan only (default)
  --apply                Perform writes (refuses conflicts unless allowed)
  --allow-overwrite      Update conflicting rows after explicit review
`);
}

async function loadExistingSnapshot(
  supabase: AdminClient,
  documentLeagueSlug: string,
  documentSeasonYear: number,
  memberEmails: string[],
): Promise<ExistingBootstrapSnapshot> {
  const snapshot: ExistingBootstrapSnapshot = {
    league: null,
    season: null,
    scoring_rules: null,
    profilesById: new Map(),
    membersByUserId: new Map(),
    weeksByNumber: new Map(),
    picksByWeekUser: new Map(),
    authUserIdByEmail: new Map(),
    teamIdByAbbreviation: new Map(),
  };

  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, abbreviation");
  if (teamsError) {
    throw new Error(`Failed to load teams: ${teamsError.message}`);
  }
  for (const team of teams ?? []) {
    snapshot.teamIdByAbbreviation.set(
      String(team.abbreviation).toUpperCase(),
      team.id,
    );
  }

  if (memberEmails.length > 0) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) {
      throw new Error(`Auth user lookup failed: ${error.message}`);
    }
    const wanted = new Set(memberEmails.map((email) => email.toLowerCase()));
    for (const user of data.users ?? []) {
      const email = (user.email ?? "").toLowerCase();
      if (wanted.has(email)) {
        snapshot.authUserIdByEmail.set(email, user.id);
      }
    }
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, slug, timezone, commissioner_user_id")
    .eq("slug", documentLeagueSlug)
    .maybeSingle();

  if (!league) {
    return snapshot;
  }

  snapshot.league = league;

  const { data: members } = await supabase
    .from("league_members")
    .select("user_id, role, active")
    .eq("league_id", league.id);
  for (const member of members ?? []) {
    snapshot.membersByUserId.set(member.user_id, member);
  }

  const userIds = (members ?? []).map((member) => member.user_id);
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    for (const profile of profiles ?? []) {
      snapshot.profilesById.set(profile.id, profile);
    }
  }

  const { data: season } = await supabase
    .from("seasons")
    .select("id, year, status, regular_week_count")
    .eq("league_id", league.id)
    .eq("year", documentSeasonYear)
    .maybeSingle();

  if (!season) {
    return snapshot;
  }

  snapshot.season = season;

  const { data: rules } = await supabase
    .from("scoring_rules")
    .select(
      "correct_regular_pick_points, best_record_bonus, longest_streak_bonus, survivor_bonus, wildcard_points, divisional_points, conference_points, superbowl_points, perfect_season_override",
    )
    .eq("season_id", season.id)
    .maybeSingle();
  snapshot.scoring_rules = rules ?? null;

  const { data: weeks } = await supabase
    .from("weeks")
    .select("id, week_number, label, locks_at, status")
    .eq("season_id", season.id);
  const weekIdToNumber = new Map<string, number>();
  for (const week of weeks ?? []) {
    snapshot.weeksByNumber.set(week.week_number, week);
    weekIdToNumber.set(week.id, week.week_number);
  }

  const weekIds = [...weekIdToNumber.keys()];
  if (weekIds.length > 0) {
    const { data: picks } = await supabase
      .from("picks")
      .select("week_id, user_id, team_id, result")
      .in("week_id", weekIds);
    const teamById = new Map(
      (teams ?? []).map((team) => [
        team.id,
        String(team.abbreviation).toUpperCase(),
      ]),
    );
    for (const pick of picks ?? []) {
      const weekNumber = weekIdToNumber.get(pick.week_id);
      if (weekNumber == null) continue;
      const abbr = teamById.get(pick.team_id) ?? "";
      snapshot.picksByWeekUser.set(`${weekNumber}:${pick.user_id}`, {
        week_number: weekNumber,
        user_id: pick.user_id,
        team_abbreviation: abbr,
        result: pick.result,
      });
    }
  }

  return snapshot;
}

/**
 * Ordered writes. Stops on first failure (rollback-safe for remaining work;
 * already-applied steps are reported). Prefer dry-run + review before --apply.
 */
async function applyPlan(options: {
  supabase: AdminClient;
  document: BootstrapImportDocument;
  plan: Extract<ReturnType<typeof planBootstrapImport>, { ok: true }>;
  allowOverwrite: boolean;
}): Promise<void> {
  const { supabase, document, plan, allowOverwrite } = options;
  const commissioner = plan.resolvedMembers.find(
    (member) => member.role === "commissioner",
  );
  if (!commissioner) {
    throw new Error("Commissioner missing from resolved members.");
  }

  for (const member of plan.resolvedMembers) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, display_name")
      .eq("id", member.userId)
      .maybeSingle();

    if (!profile) {
      const { error } = await supabase.from("profiles").insert({
        id: member.userId,
        display_name: member.display_name,
      });
      if (error) {
        throw new Error(
          `Profile insert failed for ${member.userId}: ${error.message}. Auth user must already exist.`,
        );
      }
    } else if (profile.display_name !== member.display_name && allowOverwrite) {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: member.display_name })
        .eq("id", member.userId);
      if (error) {
        throw new Error(`Profile update failed: ${error.message}`);
      }
    }
  }

  let leagueId: string;
  const { data: existingLeague } = await supabase
    .from("leagues")
    .select("id")
    .eq("slug", document.league.slug)
    .maybeSingle();

  if (!existingLeague) {
    const { data, error } = await supabase
      .from("leagues")
      .insert({
        name: document.league.name,
        slug: document.league.slug,
        timezone: document.league.timezone,
        commissioner_user_id: commissioner.userId,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`League insert failed: ${error?.message ?? "no row"}`);
    }
    leagueId = data.id;
  } else {
    leagueId = existingLeague.id;
    if (allowOverwrite) {
      const { error } = await supabase
        .from("leagues")
        .update({
          name: document.league.name,
          timezone: document.league.timezone,
          commissioner_user_id: commissioner.userId,
        })
        .eq("id", leagueId);
      if (error) {
        throw new Error(`League update failed: ${error.message}`);
      }
    }
  }

  for (const member of plan.resolvedMembers) {
    const { data: existingMember } = await supabase
      .from("league_members")
      .select("user_id, role, active")
      .eq("league_id", leagueId)
      .eq("user_id", member.userId)
      .maybeSingle();

    if (!existingMember) {
      const { error } = await supabase.from("league_members").insert({
        league_id: leagueId,
        user_id: member.userId,
        role: member.role,
        active: member.active,
      });
      if (error) {
        throw new Error(`Membership insert failed: ${error.message}`);
      }
    } else if (
      allowOverwrite &&
      (existingMember.role !== member.role ||
        existingMember.active !== member.active)
    ) {
      const { error } = await supabase
        .from("league_members")
        .update({ role: member.role, active: member.active })
        .eq("league_id", leagueId)
        .eq("user_id", member.userId);
      if (error) {
        throw new Error(`Membership update failed: ${error.message}`);
      }
    }
  }

  let seasonId: string;
  const { data: existingSeason } = await supabase
    .from("seasons")
    .select("id, status, regular_week_count, year")
    .eq("league_id", leagueId)
    .eq("year", document.season.year)
    .maybeSingle();

  if (!existingSeason) {
    const { data, error } = await supabase
      .from("seasons")
      .insert({
        league_id: leagueId,
        year: document.season.year,
        status: document.season.status,
        regular_week_count: document.season.regular_week_count,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Season insert failed: ${error?.message ?? "no row"}`);
    }
    seasonId = data.id;
  } else {
    seasonId = existingSeason.id;
    if (allowOverwrite) {
      const { error } = await supabase
        .from("seasons")
        .update({
          status: document.season.status,
          regular_week_count: document.season.regular_week_count,
        })
        .eq("id", seasonId);
      if (error) {
        throw new Error(`Season update failed: ${error.message}`);
      }
    }
  }

  const { data: existingRules } = await supabase
    .from("scoring_rules")
    .select("season_id")
    .eq("season_id", seasonId)
    .maybeSingle();

  if (!existingRules) {
    const { error } = await supabase.from("scoring_rules").insert({
      season_id: seasonId,
      ...document.scoring_rules,
    });
    if (error) {
      throw new Error(`scoring_rules insert failed: ${error.message}`);
    }
  } else if (allowOverwrite) {
    const { error } = await supabase
      .from("scoring_rules")
      .update({ ...document.scoring_rules })
      .eq("season_id", seasonId);
    if (error) {
      throw new Error(`scoring_rules update failed: ${error.message}`);
    }
  }

  const weekIdByNumber = new Map<number, string>();
  for (const week of plan.preparedWeeks) {
    const { data: existingWeek } = await supabase
      .from("weeks")
      .select("id, label, locks_at, status")
      .eq("season_id", seasonId)
      .eq("week_number", week.week_number)
      .maybeSingle();

    if (!existingWeek) {
      const { data, error } = await supabase
        .from("weeks")
        .insert({
          season_id: seasonId,
          week_number: week.week_number,
          label: week.label,
          locks_at: week.locks_at,
          status: week.status,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(
          `Week ${week.week_number} insert failed: ${error?.message ?? "no row"}`,
        );
      }
      weekIdByNumber.set(week.week_number, data.id);
    } else {
      weekIdByNumber.set(week.week_number, existingWeek.id);
      if (allowOverwrite) {
        const { error } = await supabase
          .from("weeks")
          .update({
            label: week.label,
            locks_at: week.locks_at,
            status: week.status,
          })
          .eq("id", existingWeek.id);
        if (error) {
          throw new Error(`Week ${week.week_number} update failed: ${error.message}`);
        }
      }
    }
  }

  for (const pick of plan.preparedPicks) {
    const weekId = weekIdByNumber.get(pick.week_number);
    const teamId = (
      await supabase
        .from("teams")
        .select("id")
        .eq("abbreviation", pick.team_abbreviation)
        .maybeSingle()
    ).data?.id;

    if (!weekId || !teamId) {
      throw new Error(
        `Pick week ${pick.week_number} missing week or team ${pick.team_abbreviation}.`,
      );
    }

    const { data: existingPick } = await supabase
      .from("picks")
      .select("id, team_id, result")
      .eq("week_id", weekId)
      .eq("user_id", pick.user_id)
      .maybeSingle();

    if (!existingPick) {
      const { error } = await supabase.from("picks").insert({
        week_id: weekId,
        user_id: pick.user_id,
        team_id: teamId,
        result: pick.result,
      });
      if (error) {
        throw new Error(`Pick insert failed: ${error.message}`);
      }
    } else if (allowOverwrite) {
      const { error } = await supabase
        .from("picks")
        .update({ team_id: teamId, result: pick.result })
        .eq("id", existingPick.id);
      if (error) {
        throw new Error(`Pick update failed: ${error.message}`);
      }
    }
  }
}

function printPlan(plan: ReturnType<typeof planBootstrapImport>) {
  if (!plan.ok) {
    console.error(`Plan failed: ${plan.error}`);
    for (const conflict of plan.conflicts) {
      console.error(
        `  - [${conflict.entity}] ${conflict.key}: ${conflict.message}`,
      );
    }
    return;
  }

  console.log(
    JSON.stringify(
      {
        dryRun: plan.dryRun,
        counts: plan.counts,
        mutationCount: plan.mutations.length,
        conflicts: plan.conflicts,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    printHelp();
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    console.error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (admin script only).",
    );
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), args.file);
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  const validated = validateBootstrapDocument(raw);
  if (!validated.ok) {
    console.error(`Validation failed: ${validated.error}`);
    process.exit(1);
  }

  const document = validated.document;
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const memberEmails = document.members
    .map((member) => member.email)
    .filter((email): email is string => Boolean(email));

  const existing = await loadExistingSnapshot(
    supabase,
    document.league.slug,
    document.season.year,
    memberEmails,
  );

  const plan = planBootstrapImport({
    document,
    existing,
    dryRun: args.dryRun,
    allowOverwrite: args.allowOverwrite,
  });

  printPlan(plan);
  if (!plan.ok) {
    process.exit(1);
  }

  if (args.dryRun || !args.apply) {
    console.log("Dry-run complete. No writes performed.");
    process.exit(0);
  }

  await applyPlan({
    supabase,
    document,
    plan,
    allowOverwrite: args.allowOverwrite,
  });
  console.log("Apply complete.", plan.counts);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

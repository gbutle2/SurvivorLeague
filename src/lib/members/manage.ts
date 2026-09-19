import "server-only";

import { type SupabaseClient, type User } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import {
  generateTemporaryPassword,
  temporaryPasswordMeetsPolicy,
} from "@/lib/members/temp-password";
import {
  MemberManagementError,
  logMemberError,
  normalizeDisplayName,
  normalizeEmail,
  validateDisplayName,
  validateEmail,
} from "@/lib/members/validation";
import {
  addExclusivePlayerMembership,
  applyPlayerActiveUpdate,
  compensateFailedPlayerSetup,
  type CompensationAdmin,
} from "@/lib/members/membership-mutations";
import {
  assertDeactivateAllowed,
  assertPlayerPasswordResetAllowed,
} from "@/lib/members/policy";
import { createAdminClient, isAdminConfigError } from "@/lib/supabase/admin";
import {
  isCommissioner,
  loadLeagueContext,
  type LeagueContext,
} from "@/lib/league/context";
import { createClient as createServerClient } from "@/lib/supabase/server";

export type AdminClient = SupabaseClient<Database>;

export type MemberListItem = {
  userId: string;
  displayName: string;
  email: string | null;
  role: "commissioner" | "player";
  active: boolean;
  joinedAt: string;
  passwordStatus: "temporary" | "changed";
};

async function requireActiveCommissioner(): Promise<LeagueContext> {
  const result = await loadLeagueContext();
  if (!result.ok) {
    if (result.code === "unauthenticated") {
      throw new MemberManagementError("unauthorized", "Sign in to continue.");
    }
    throw new MemberManagementError(
      "forbidden",
      "Only an active league commissioner can manage members.",
    );
  }
  if (!isCommissioner(result.context) || !result.context.membership.active) {
    throw new MemberManagementError(
      "forbidden",
      "Only an active league commissioner can manage members.",
    );
  }
  return result.context;
}

/** Submitted league/user/role values are ignored; session + DB decide. */
export async function authorizeCommissionerMemberAction(_submitted?: {
  leagueId?: string | null;
  userId?: string | null;
  role?: string | null;
}): Promise<LeagueContext> {
  void _submitted;
  return requireActiveCommissioner();
}

function isDuplicateEmailError(message: string): boolean {
  return /already.*(registered|exists|been)|duplicate|unique.*email/i.test(
    message,
  );
}

export async function listLeagueMembers(): Promise<MemberListItem[]> {
  const context = await requireActiveCommissioner();
  const supabase = await createServerClient();
  const { data: rows, error } = await supabase
    .from("league_members")
    .select("user_id, role, active, joined_at")
    .eq("league_id", context.league.id)
    .order("joined_at", { ascending: true });

  if (error) {
    throw new MemberManagementError(
      "unexpected",
      "Could not load league members.",
    );
  }

  const memberRows = rows ?? [];
  const userIds = memberRows.map((row) => row.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", userIds)
    : { data: [] as { id: string; display_name: string }[] };
  const displayById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.display_name]),
  );

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch (error) {
    if (isAdminConfigError(error)) {
      throw new MemberManagementError(
        "config",
        "Member administration is not configured on this server.",
      );
    }
    throw error;
  }

  const items: MemberListItem[] = [];
  for (const row of memberRows) {
    const { data: authData, error: authError } = await admin.auth.admin.getUserById(
      row.user_id,
    );
    if (authError || !authData.user) {
      logMemberError("list_members", "AUTH_LOOKUP_FAILED");
      items.push({
        userId: row.user_id,
        displayName: displayById.get(row.user_id) ?? "Player",
        email: null,
        role: row.role,
        active: row.active,
        joinedAt: row.joined_at,
        passwordStatus: "changed",
      });
      continue;
    }
    const mustChange =
      authData.user.app_metadata?.must_change_password === true;
    items.push({
      userId: row.user_id,
      displayName: displayById.get(row.user_id) ?? "Player",
      email: authData.user.email ?? null,
      role: row.role,
      active: row.active,
      joinedAt: row.joined_at,
      passwordStatus: mustChange ? "temporary" : "changed",
    });
  }
  return items;
}

export type CreatePlayerResult = {
  userId: string;
  email: string;
  displayName: string;
  temporaryPassword: string;
};

export async function createPlayerAccount(input: {
  email: string;
  displayName: string;
  temporaryPassword: string;
  /** Ignored — league comes from commissioner session. */
  leagueId?: string | null;
}): Promise<CreatePlayerResult> {
  const context = await authorizeCommissionerMemberAction({
    leagueId: input.leagueId,
  });
  const email = normalizeEmail(input.email);
  const displayName = normalizeDisplayName(input.displayName);
  const temporaryPassword = input.temporaryPassword;

  if (!validateEmail(email)) {
    throw new MemberManagementError(
      "invalid_email",
      "Enter a valid email address.",
    );
  }
  if (!validateDisplayName(displayName)) {
    throw new MemberManagementError(
      "invalid_display_name",
      "Display name must be 1–40 characters.",
    );
  }
  if (!temporaryPasswordMeetsPolicy(temporaryPassword)) {
    throw new MemberManagementError(
      "invalid_password",
      "Temporary password must be at least 20 characters and include uppercase, lowercase, a number, and a symbol.",
    );
  }

  const supabase = await createServerClient();

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch (error) {
    if (isAdminConfigError(error)) {
      throw new MemberManagementError(
        "config",
        "Member administration is not configured on this server.",
      );
    }
    throw error;
  }

  let createdUser: User | null = null;
  let newlyCreatedAuthUser = false;

  try {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { display_name: displayName },
      app_metadata: { must_change_password: true },
    });

    if (error || !data.user) {
      const message = error?.message ?? "";
      if (isDuplicateEmailError(message)) {
        throw new MemberManagementError(
          "duplicate_email",
          "That email is already registered. Review the existing account instead of creating another.",
        );
      }
      logMemberError("create_player", "AUTH_CREATE_FAILED");
      throw new MemberManagementError(
        "setup_failed",
        "Could not create the player account.",
      );
    }

    createdUser = data.user;
    newlyCreatedAuthUser = true;
    const userId = createdUser.id;

    // Profile is created by on_auth_user_created; ensure display name.
    const { error: profileError } = await admin.from("profiles").upsert(
      { id: userId, display_name: displayName },
      { onConflict: "id" },
    );
    if (profileError) {
      logMemberError("create_player", "PROFILE_UPSERT_FAILED");
      throw new MemberManagementError(
        "setup_failed",
        "Could not finish player profile setup.",
      );
    }

    await addExclusivePlayerMembership({
      leagueId: context.league.id,
      userId,
      findExistingMembership: async ({ leagueId, userId: memberUserId }) => {
        const { data } = await supabase
          .from("league_members")
          .select("user_id")
          .eq("league_id", leagueId)
          .eq("user_id", memberUserId)
          .maybeSingle();
        return data;
      },
      insertMembership: async ({ leagueId, userId: memberUserId }) => {
        const { error } = await supabase.from("league_members").insert({
          league_id: leagueId,
          user_id: memberUserId,
          role: "player",
          active: true,
        });
        return { error };
      },
    });

    const { data: verifiedProfile } = await admin
      .from("profiles")
      .select("id, display_name")
      .eq("id", userId)
      .maybeSingle();
    const { data: verifiedMember } = await supabase
      .from("league_members")
      .select("user_id, role, active")
      .eq("league_id", context.league.id)
      .eq("user_id", userId)
      .maybeSingle();

    if (
      !verifiedProfile ||
      verifiedProfile.display_name !== displayName ||
      !verifiedMember ||
      verifiedMember.role !== "player" ||
      verifiedMember.active !== true
    ) {
      logMemberError("create_player", "VERIFY_FAILED");
      throw new MemberManagementError(
        "setup_failed",
        "Player setup could not be verified.",
      );
    }

    newlyCreatedAuthUser = false; // success — do not delete on outer catch
    return {
      userId,
      email,
      displayName,
      temporaryPassword,
    };
  } catch (error) {
    if (newlyCreatedAuthUser && createdUser) {
      await compensateFailedPlayerSetup(admin as unknown as CompensationAdmin, {
        leagueId: context.league.id,
        userId: createdUser.id,
        deleteAuthUser: true,
      });
    }
    if (error instanceof MemberManagementError) {
      throw error;
    }
    logMemberError("create_player", "UNEXPECTED");
    throw new MemberManagementError(
      "setup_failed",
      "Could not create the player account.",
    );
  }
}

export async function resetPlayerTemporaryPassword(input: {
  targetUserId: string;
}): Promise<{ temporaryPassword: string; email: string | null }> {
  const context = await requireActiveCommissioner();
  const targetUserId = input.targetUserId.trim();
  if (!targetUserId) {
    throw new MemberManagementError("not_found", "Player not found.");
  }

  const supabase = await createServerClient();
  const { data: membership, error: membershipLookupError } = await supabase
    .from("league_members")
    .select("user_id, role, active")
    .eq("league_id", context.league.id)
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (membershipLookupError) {
    throw new MemberManagementError(
      "not_found",
      "That player is not in your league.",
    );
  }

  assertPlayerPasswordResetAllowed({
    actorUserId: context.userId,
    actorLeagueId: context.league.id,
    submittedLeagueId: null,
    target: membership
      ? {
          userId: membership.user_id,
          role: membership.role,
          active: membership.active,
        }
      : null,
  });

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch (error) {
    if (isAdminConfigError(error)) {
      throw new MemberManagementError(
        "config",
        "Member administration is not configured on this server.",
      );
    }
    throw error;
  }

  const temporaryPassword = generateTemporaryPassword();
  const { data, error: updateError } = await admin.auth.admin.updateUserById(
    targetUserId,
    {
      password: temporaryPassword,
      app_metadata: { must_change_password: true },
    },
  );

  if (updateError || !data.user) {
    logMemberError("reset_password", "AUTH_UPDATE_FAILED");
    throw new MemberManagementError(
      "unexpected",
      "Could not reset the temporary password.",
    );
  }

  // Session revocation: Admin signOut requires a user JWT in this SDK version.
  // We do not have other sessions' JWTs, so existing sessions are not force-revoked.
  // Documented limitation — player must use the new temporary password on next login.

  return {
    temporaryPassword,
    email: data.user.email ?? null,
  };
}

export async function setMemberActive(input: {
  targetUserId: string;
  active: boolean;
}): Promise<void> {
  const context = await requireActiveCommissioner();
  const targetUserId = input.targetUserId.trim();

  if (targetUserId === context.userId) {
    throw new MemberManagementError(
      "forbidden",
      "You cannot deactivate your own commissioner account.",
    );
  }

  const supabase = await createServerClient();
  const { data: membership, error } = await supabase
    .from("league_members")
    .select("user_id, role, active")
    .eq("league_id", context.league.id)
    .eq("user_id", targetUserId)
    .maybeSingle();

  const target = membership
    ? {
        userId: membership.user_id,
        role: membership.role,
        active: membership.active,
      }
    : null;

  if (error) {
    throw new MemberManagementError(
      "not_found",
      "That player is not in your league.",
    );
  }

  assertDeactivateAllowed({
    actorUserId: context.userId,
    target,
  });

  if (membership!.active === input.active) {
    return;
  }

  await applyPlayerActiveUpdate({
    supabase: supabase as never,
    leagueId: context.league.id,
    targetUserId,
    active: input.active,
  });
}

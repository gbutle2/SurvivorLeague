import { MemberManagementError, logMemberError } from "./validation.ts";

export type MembershipActiveRow = {
  user_id: string;
  role: "commissioner" | "player";
  active: boolean;
};

type ActiveUpdateChain = {
  update: (values: { active: boolean }) => {
    eq: (column: string, value: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          select: (columns: string) => {
            maybeSingle: () => Promise<{
              data: MembershipActiveRow | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
  };
};

/**
 * Fail-closed membership active update. Requires a returned row with the
 * requested active value — zero rows or errors are failures.
 */
export async function applyPlayerActiveUpdate(input: {
  supabase: {
    from: (table: "league_members") => ActiveUpdateChain;
  };
  leagueId: string;
  targetUserId: string;
  active: boolean;
}): Promise<MembershipActiveRow> {
  const { data: updated, error: updateError } = await input.supabase
    .from("league_members")
    .update({ active: input.active })
    .eq("league_id", input.leagueId)
    .eq("user_id", input.targetUserId)
    .eq("role", "player")
    .select("user_id, role, active")
    .maybeSingle();

  if (updateError) {
    logMemberError("set_active", "MEMBERSHIP_UPDATE_FAILED");
    throw new MemberManagementError(
      "unexpected",
      input.active
        ? "Could not reactivate the player."
        : "Could not deactivate the player.",
    );
  }

  if (!updated) {
    logMemberError("set_active", "MEMBERSHIP_UPDATE_ZERO_ROW");
    throw new MemberManagementError(
      "not_found",
      "Membership could not be updated. It may have been removed.",
    );
  }

  if (updated.role !== "player" || updated.active !== input.active) {
    logMemberError("set_active", "MEMBERSHIP_UPDATE_MISMATCH");
    throw new MemberManagementError(
      "unexpected",
      input.active
        ? "Could not reactivate the player."
        : "Could not deactivate the player.",
    );
  }

  return updated;
}

/**
 * Membership insert for a new player. Does not query or enforce active-member
 * capacity. Duplicate membership is rejected.
 */
export async function addExclusivePlayerMembership(input: {
  /** Optional observer used by tests — production never supplies a counter. */
  observeCapacityQuery?: (label: string) => void;
  findExistingMembership: (args: {
    leagueId: string;
    userId: string;
  }) => Promise<{ user_id: string } | null>;
  insertMembership: (args: {
    leagueId: string;
    userId: string;
  }) => Promise<{ error: { message: string } | null }>;
  leagueId: string;
  userId: string;
  /** Present only so tests can prove capacity is ignored, never consulted. */
  existingActiveMemberCount?: number;
}): Promise<void> {
  void input.existingActiveMemberCount;
  // Capacity is intentionally not queried or enforced.
  input.observeCapacityQuery?.("skipped");

  const existing = await input.findExistingMembership({
    leagueId: input.leagueId,
    userId: input.userId,
  });
  if (existing) {
    throw new MemberManagementError(
      "duplicate_membership",
      "That user is already a member of this league.",
    );
  }

  const { error: memberError } = await input.insertMembership({
    leagueId: input.leagueId,
    userId: input.userId,
  });

  if (memberError) {
    if (/unique|duplicate/i.test(memberError.message)) {
      throw new MemberManagementError(
        "duplicate_membership",
        "That user is already a member of this league.",
      );
    }
    logMemberError("create_player", "MEMBERSHIP_INSERT_FAILED");
    throw new MemberManagementError(
      "setup_failed",
      "Could not add the player to the league.",
    );
  }
}

export type CompensationAdmin = {
  from: (table: "league_members") => {
    delete: () => {
      eq: (column: string, value: string) => {
        eq: (
          column: string,
          value: string,
        ) => Promise<{ error: { message: string; code?: string } | null }>;
      };
    };
  };
  auth: {
    admin: {
      deleteUser: (
        userId: string,
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

/**
 * Failed-create compensation. Inspects returned `{ error }` objects (Supabase
 * does not throw on query failure). Deletes Auth user only when requested
 * (newly created in this request). Auth deletion is attempted even if
 * membership cleanup fails.
 */
export async function compensateFailedPlayerSetup(
  admin: CompensationAdmin,
  options: { leagueId: string; userId: string; deleteAuthUser: boolean },
): Promise<void> {
  const { error: membershipError } = await admin
    .from("league_members")
    .delete()
    .eq("league_id", options.leagueId)
    .eq("user_id", options.userId);

  if (membershipError) {
    logMemberError("compensation", "MEMBERSHIP_CLEANUP_FAILED");
  }

  if (!options.deleteAuthUser) {
    return;
  }

  // Only delete Auth users we just created in this request — never a pre-existing user.
  // Attempt Auth deletion even if membership cleanup returned an error (FK cascade may finish cleanup).
  const { error } = await admin.auth.admin.deleteUser(options.userId);
  if (error) {
    logMemberError("compensation", "AUTH_DELETE_FAILED");
  }
}

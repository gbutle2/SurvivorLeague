import { MemberManagementError } from "./validation.ts";

export type MembershipSnapshot = {
  userId: string;
  role: "commissioner" | "player";
  active: boolean;
};

/** Pure authorization checks used by member management (testable without Admin API). */
export function assertPlayerPasswordResetAllowed(input: {
  actorUserId: string;
  target: MembershipSnapshot | null;
  submittedLeagueId?: string | null;
  actorLeagueId: string;
}): MembershipSnapshot {
  void input.submittedLeagueId; // always ignored
  if (!input.target) {
    throw new MemberManagementError(
      "not_found",
      "That player is not in your league.",
    );
  }
  if (input.target.role !== "player") {
    throw new MemberManagementError(
      "forbidden",
      "Commissioner passwords cannot be reset here.",
    );
  }
  if (!input.target.active) {
    throw new MemberManagementError(
      "forbidden",
      "Reactivate the player before resetting their password.",
    );
  }
  return input.target;
}

export function assertDeactivateAllowed(input: {
  actorUserId: string;
  target: MembershipSnapshot | null;
}): MembershipSnapshot {
  if (!input.target) {
    throw new MemberManagementError(
      "not_found",
      "That player is not in your league.",
    );
  }
  if (input.target.userId === input.actorUserId) {
    throw new MemberManagementError(
      "forbidden",
      "You cannot deactivate your own commissioner account.",
    );
  }
  if (input.target.role === "commissioner") {
    throw new MemberManagementError(
      "forbidden",
      "Commissioner accounts cannot be deactivated here.",
    );
  }
  if (input.target.role !== "player") {
    throw new MemberManagementError(
      "forbidden",
      "Only players can be updated here.",
    );
  }
  return input.target;
}

export function shouldDeleteAuthUserOnCompensation(input: {
  newlyCreatedInThisRequest: boolean;
  preExistingUser: boolean;
}): boolean {
  return input.newlyCreatedInThisRequest && !input.preExistingUser;
}

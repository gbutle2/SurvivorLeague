import type { MemberRole } from "@/lib/database.types";

/** Session identity always wins; submitted user ids are ignored. */
export function authenticatedUserId(
  sessionUserId: string,
  submittedUserId?: string | null,
): string {
  void submittedUserId;
  return sessionUserId;
}

/** Application-level commissioner gate (RLS remains authoritative). */
export function commissionerActionDenied(
  role: MemberRole | null | undefined,
): string | null {
  if (role !== "commissioner") {
    return "Only the commissioner can manage weeks.";
  }
  return null;
}

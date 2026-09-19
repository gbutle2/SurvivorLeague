import "server-only";

import type { AccountMenuIdentity } from "@/lib/account/menu-identity";
import { resolveMenuTargetUserId } from "@/lib/account/menu-identity";
import { createClient } from "@/lib/supabase/server";

/**
 * Load the authenticated user's account-menu identity.
 * Session identity only — never from form input. Never uses the service role.
 */
export async function loadAccountMenuIdentity(input?: {
  /** Ignored — session user is the only allowed target. */
  submittedUserId?: string | null;
}): Promise<AccountMenuIdentity | null> {
  void input?.submittedUserId;

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const userId = resolveMenuTargetUserId(user.id, input?.submittedUserId);

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  const fromProfile =
    typeof profile?.display_name === "string" && profile.display_name.trim()
      ? profile.display_name.trim()
      : null;
  const fromMetadata =
    typeof user.user_metadata?.display_name === "string" &&
    user.user_metadata.display_name.trim()
      ? user.user_metadata.display_name.trim()
      : null;

  return {
    displayName: fromProfile ?? fromMetadata,
    email: user.email ?? null,
  };
}

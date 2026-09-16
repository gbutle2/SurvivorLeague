import { createClient } from "@/lib/supabase/server";

export type SessionPlayer = {
  userId: string;
  email: string | null;
  displayName: string;
  isCommissioner: boolean;
  connectionStatus: "connected" | "degraded";
};

export async function getSessionPlayer(): Promise<SessionPlayer | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const { data: commissionerMemberships, error: roleError } = await supabase
    .from("league_members")
    .select("league_id")
    .eq("user_id", user.id)
    .eq("role", "commissioner")
    .eq("active", true)
    .limit(1);

  const connectionStatus =
    profileError || roleError ? "degraded" : "connected";

  return {
    userId: user.id,
    email: user.email ?? null,
    displayName:
      profile?.display_name ??
      user.user_metadata?.display_name ??
      user.email?.split("@")[0] ??
      "Player",
    isCommissioner: (commissionerMemberships?.length ?? 0) > 0,
    connectionStatus,
  };
}

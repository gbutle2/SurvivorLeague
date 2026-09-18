import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

const CONFIG_ERROR =
  "Server authentication administration is not configured.";

/**
 * Service-role Supabase client for Auth administration only.
 * Never import from Client Components. Never log or return the key.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!url || !serviceRoleKey) {
    throw new Error(CONFIG_ERROR);
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function isAdminConfigError(error: unknown): boolean {
  return error instanceof Error && error.message === CONFIG_ERROR;
}

/** Interpret a Supabase update/insert `.select().maybeSingle()` payload. */
export function requireMutationRow<T>(
  data: T | null | undefined,
  zeroRowMessage: string,
): { ok: true; row: T } | { ok: false; error: string } {
  if (data == null) {
    return { ok: false, error: zeroRowMessage };
  }
  return { ok: true, row: data };
}

export const PICK_UPDATE_ZERO_ROW =
  "Your pick was not changed. The deadline or your permissions may have changed. Refresh and try again.";

export const PICK_INSERT_ZERO_ROW =
  "Your pick was not saved. The deadline or your permissions may have changed. Refresh and try again.";

export const COMMISSIONER_UPDATE_ZERO_ROW =
  "That record was not changed. Refresh and try again.";

export const SEASON_ACTIVATION_ZERO_ROW =
  "The season was not activated. It may already be active, or your permissions changed. Refresh and try again.";

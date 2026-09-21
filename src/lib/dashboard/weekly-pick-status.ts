export type WeeklyPickDisplayState = "visible" | "hidden" | "missing";

/**
 * Maps RLS-visible pick rows + privacy-safe has_pick into dashboard state.
 * - visible: authorized pick row is present (team may be shown)
 * - hidden: submitted but not revealed (show "Submitted", no team)
 * - missing: no pick (show "Not submitted")
 */
export function resolveWeeklyPickDisplayState(args: {
  hasVisiblePick: boolean;
  hasPick: boolean;
}): WeeklyPickDisplayState {
  if (args.hasVisiblePick) return "visible";
  if (args.hasPick) return "hidden";
  return "missing";
}

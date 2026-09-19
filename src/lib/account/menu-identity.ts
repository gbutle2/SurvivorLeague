/**
 * Pure helpers for the authenticated account-menu trigger and panel.
 * No React dependency — unit-testable without a DOM harness.
 */

export type AccountMenuIdentity = {
  displayName: string | null;
  email: string | null;
};

/** First+last initials for multi-word names; first initial otherwise; null if missing. */
export function accountInitials(
  displayName: string | null | undefined,
): string | null {
  const trimmed = displayName?.trim() ?? "";
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    const first = parts[0]![0];
    return first ? first.toUpperCase() : null;
  }
  const first = parts[0]![0];
  const last = parts[parts.length - 1]![0];
  if (!first || !last) return null;
  return `${first}${last}`.toUpperCase();
}

/** Short label for the open trigger on wider screens. */
export function accountTriggerLabel(
  displayName: string | null | undefined,
): string | null {
  const trimmed = displayName?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export type AccountMenuUiState = {
  open: boolean;
};

export type AccountMenuUiAction =
  | { type: "toggle" }
  | { type: "open" }
  | { type: "close" }
  | { type: "escape" }
  | { type: "outside" }
  | { type: "select" };

export function reduceAccountMenuUi(
  state: AccountMenuUiState,
  action: AccountMenuUiAction,
): AccountMenuUiState {
  switch (action.type) {
    case "toggle":
      return { open: !state.open };
    case "open":
      return { open: true };
    case "close":
    case "escape":
    case "outside":
    case "select":
      return { open: false };
    default:
      return state;
  }
}

export function accountMenuTriggerAria(open: boolean): {
  "aria-expanded": boolean;
  "aria-haspopup": "menu";
  "aria-label": string;
} {
  return {
    "aria-expanded": open,
    "aria-haspopup": "menu",
    "aria-label": "Open account menu",
  };
}

/** Session user always wins; submitted ids are ignored. */
export function resolveMenuTargetUserId(
  sessionUserId: string,
  submittedUserId?: string | null,
): string {
  void submittedUserId;
  return sessionUserId;
}

export type AvailabilityMember = {
  userId: string;
  displayName: string;
};

export type AvailabilityMemberOption = {
  userId: string;
  /** Dropdown label, including "You" and duplicate disambiguation. */
  label: string;
  displayName: string;
};

/**
 * Resolve the member whose availability to show.
 * Invalid / inactive / cross-league IDs fall back to the viewer without disclosure.
 */
export function resolveAvailabilityMemberId(input: {
  viewerId: string;
  requestedId: string | null | undefined;
  activeMemberIds: ReadonlySet<string>;
}): string {
  const requested = input.requestedId?.trim() ?? "";
  if (requested && input.activeMemberIds.has(requested)) {
    return requested;
  }
  return input.viewerId;
}

/**
 * Order members for the selector: viewer first as "You", then A–Z by display name.
 * Duplicate display names get a stable disambiguator that is not an email.
 */
export function buildAvailabilityMemberOptions(input: {
  viewerId: string;
  members: readonly AvailabilityMember[];
}): AvailabilityMemberOption[] {
  const unique = new Map<string, AvailabilityMember>();
  for (const member of input.members) {
    unique.set(member.userId, {
      userId: member.userId,
      displayName: member.displayName.trim() || "Player",
    });
  }

  const nameCounts = new Map<string, number>();
  for (const member of unique.values()) {
    const key = member.displayName.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const sortedForLabels = [...unique.values()].sort((a, b) =>
    a.userId.localeCompare(b.userId),
  );
  const nameOrdinal = new Map<string, number>();
  const labeledById = new Map<
    string,
    { userId: string; displayName: string }
  >();
  for (const member of sortedForLabels) {
    const key = member.displayName.toLowerCase();
    const total = nameCounts.get(key) ?? 1;
    let displayName = member.displayName;
    if (total > 1) {
      const next = (nameOrdinal.get(key) ?? 0) + 1;
      nameOrdinal.set(key, next);
      displayName = `${member.displayName} (${next})`;
    }
    labeledById.set(member.userId, {
      userId: member.userId,
      displayName,
    });
  }

  const labeled = [...labeledById.values()];
  const viewer = labeled.find((member) => member.userId === input.viewerId);
  const others = labeled
    .filter((member) => member.userId !== input.viewerId)
    .sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, {
        sensitivity: "base",
      }),
    );

  const options: AvailabilityMemberOption[] = [];
  if (viewer) {
    options.push({
      userId: viewer.userId,
      displayName: viewer.displayName,
      label: `${viewer.displayName} (You)`,
    });
  }
  for (const member of others) {
    options.push({
      userId: member.userId,
      displayName: member.displayName,
      label: member.displayName,
    });
  }
  return options;
}

export function selectedMemberHeading(
  options: readonly AvailabilityMemberOption[],
  selectedId: string,
  viewerId: string,
): string {
  const selected = options.find((option) => option.userId === selectedId);
  if (!selected) {
    return "Your teams";
  }
  if (selected.userId === viewerId) {
    return "Your teams";
  }
  return `${selected.displayName}'s teams`;
}

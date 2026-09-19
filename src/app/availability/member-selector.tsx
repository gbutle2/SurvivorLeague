"use client";

import { useRouter } from "next/navigation";
import type { ChangeEvent } from "react";

import type { AvailabilityMemberOption } from "@/lib/availability/member-options";

type AvailabilityMemberSelectorProps = {
  members: AvailabilityMemberOption[];
  selectedId: string;
};

/**
 * Progressive-enhancement member picker.
 * GET form works without JS; onChange navigates when JS is available.
 * Authorization and pick privacy remain entirely server-side.
 */
export function AvailabilityMemberSelector({
  members,
  selectedId,
}: AvailabilityMemberSelectorProps) {
  const router = useRouter();

  function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const memberId = event.target.value;
    const params = new URLSearchParams();
    params.set("member", memberId);
    router.push(`/availability?${params.toString()}`);
  }

  return (
    <form method="get" action="/availability" className="mb-4 space-y-2">
      <label
        htmlFor="availability-member"
        className="block text-sm font-medium text-stone-700"
      >
        View player
      </label>
      <select
        id="availability-member"
        name="member"
        defaultValue={selectedId}
        onChange={onChange}
        className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/30"
      >
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.label}
          </option>
        ))}
      </select>
      <noscript>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white"
        >
          View
        </button>
      </noscript>
    </form>
  );
}

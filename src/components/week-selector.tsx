"use client";

import { useRouter } from "next/navigation";

import type { WeekSelectorOption } from "@/lib/weeks/week-selector";

type WeekSelectorProps = {
  options: WeekSelectorOption[];
  selectedWeekNumber: number;
  /** Base path for navigation (e.g. "/" or "/pick"). */
  pathname?: string;
};

export function WeekSelector({
  options,
  selectedWeekNumber,
  pathname = "/",
}: WeekSelectorProps) {
  const router = useRouter();

  if (options.length === 0) {
    return (
      <p className="text-sm text-stone-600">
        No scheduled weeks are available yet.
      </p>
    );
  }

  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
        Week
      </span>
      <select
        className="min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-base font-semibold text-stone-900 shadow-sm"
        value={selectedWeekNumber}
        aria-label="Select NFL week"
        onChange={(event) => {
          const week = event.target.value;
          const params = new URLSearchParams();
          params.set("week", week);
          router.push(`${pathname}?${params.toString()}`);
        }}
      >
        {options.map((option) => (
          <option key={option.weekId} value={option.weekNumber}>
            {option.optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

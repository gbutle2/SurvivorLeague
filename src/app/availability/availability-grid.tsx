"use client";

import { useMemo, useState } from "react";

export type AvailabilityTeam = {
  id: string;
  abbreviation: string;
  city: string;
  name: string;
  status: "AVAILABLE" | "USED" | "CURRENT";
};

export function AvailabilityGrid({ teams }: { teams: AvailabilityTeam[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "AVAILABLE" | "USED" | "CURRENT">(
    "ALL",
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return teams.filter((team) => {
      if (filter !== "ALL" && team.status !== filter) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return `${team.city} ${team.name} ${team.abbreviation}`
        .toLowerCase()
        .includes(needle);
    });
  }, [teams, query, filter]);

  return (
    <div className="space-y-3">
      <label htmlFor="availability-search" className="sr-only">
        Search teams
      </label>
      <input
        id="availability-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search teams"
        className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base outline-none ring-emerald-700/30 focus:border-emerald-700 focus:ring-2"
      />

      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        role="group"
        aria-label="Filter by status"
      >
        {(
          [
            ["ALL", "All"],
            ["AVAILABLE", "Available"],
            ["USED", "Used"],
            ["CURRENT", "Current"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={[
              "min-h-11 rounded-lg border px-2 text-sm font-semibold",
              filter === value
                ? "border-emerald-800 bg-emerald-800 text-white"
                : "border-stone-300 bg-white text-stone-800",
            ].join(" ")}
            aria-pressed={filter === value}
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {filtered.map((team) => (
          <li key={team.id}>
            <AvailabilityCard team={team} />
          </li>
        ))}
      </ul>

      {filtered.length === 0 ? (
        <p className="text-sm text-stone-600">No teams match this filter.</p>
      ) : null}
    </div>
  );
}

function AvailabilityCard({ team }: { team: AvailabilityTeam }) {
  const styles =
    team.status === "USED"
      ? "border-red-300 bg-red-50"
      : team.status === "CURRENT"
        ? "border-emerald-700 bg-emerald-50"
        : "border-emerald-300 bg-emerald-50/70";

  const badge =
    team.status === "USED"
      ? { text: "USED", icon: "✕", className: "text-red-800" }
      : team.status === "CURRENT"
        ? { text: "CURRENT WEEK", icon: "●", className: "text-emerald-900" }
        : { text: "AVAILABLE", icon: "✓", className: "text-emerald-800" };

  return (
    <article
      className={`rounded-xl border p-3 shadow-sm ${styles}`}
      aria-label={`${team.city} ${team.name}, ${badge.text}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-stone-900">
            {team.abbreviation}
          </p>
          <p className="text-sm text-stone-700">
            {team.city} {team.name}
          </p>
        </div>
        <p
          className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide ${badge.className}`}
        >
          <span aria-hidden>{badge.icon}</span>
          {badge.text}
        </p>
      </div>
    </article>
  );
}

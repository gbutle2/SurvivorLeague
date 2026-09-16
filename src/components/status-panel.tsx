import type { ReactNode } from "react";

type StatusPanelProps = {
  title: string;
  children: ReactNode;
  tone?: "neutral" | "warning" | "danger" | "success";
};

const toneClasses: Record<NonNullable<StatusPanelProps["tone"]>, string> = {
  neutral: "border-stone-200 bg-white text-stone-800",
  warning: "border-amber-300 bg-amber-50 text-amber-950",
  danger: "border-red-300 bg-red-50 text-red-950",
  success: "border-emerald-300 bg-emerald-50 text-emerald-950",
};

export function StatusPanel({
  title,
  children,
  tone = "neutral",
}: StatusPanelProps) {
  return (
    <section
      role="status"
      className={`rounded-2xl border p-4 shadow-sm ${toneClasses[tone]}`}
    >
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

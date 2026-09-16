import Link from "next/link";

type NavCardProps = {
  title: string;
  description: string;
  href?: string;
  badge?: string;
};

export function NavCard({ title, description, href, badge }: NavCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-stone-900">{title}</h2>
        {badge ? (
          <span className="shrink-0 rounded-md bg-stone-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-stone-600">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-stone-600">{description}</p>
      {href ? (
        <p className="mt-3 text-sm font-semibold text-emerald-900">Open →</p>
      ) : (
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-emerald-800/70">
          Coming in a later phase
        </p>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block min-h-11 rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 active:border-emerald-700/50"
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      {body}
    </div>
  );
}

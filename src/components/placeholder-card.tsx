type PlaceholderCardProps = {
  title: string;
  description: string;
  href?: string;
};

export function PlaceholderCard({
  title,
  description,
  href,
}: PlaceholderCardProps) {
  const content = (
    <>
      <h2 className="text-base font-semibold text-stone-900">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-stone-600">
        {description}
      </p>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-emerald-800/70">
        Coming in a later phase
      </p>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className="block rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-emerald-700/40 hover:shadow"
      >
        {content}
      </a>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      {content}
    </div>
  );
}

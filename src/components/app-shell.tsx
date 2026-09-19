import Link from "next/link";
import type { ReactNode } from "react";

import { AccountMenuHeader } from "@/components/account-menu-header";

type AppShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  backHref?: string;
  backLabel?: string;
  /** When false, omit the account menu (unused today; reserved for edge cases). */
  showAccountMenu?: boolean;
};

export async function AppShell({
  title,
  subtitle,
  children,
  backHref = "/",
  backLabel = "Home",
  showAccountMenu = true,
}: AppShellProps) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 sm:py-8">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={backHref}
            className="inline-flex min-h-11 items-center text-sm font-medium text-emerald-900 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
          >
            ← {backLabel}
          </Link>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
            Private league
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-sm leading-relaxed text-stone-600">
              {subtitle}
            </p>
          ) : null}
        </div>
        {showAccountMenu ? <AccountMenuHeader /> : null}
      </header>
      {children}
    </main>
  );
}

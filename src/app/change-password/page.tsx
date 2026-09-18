import type { Metadata } from "next";

import { ChangePasswordForm } from "@/app/change-password/change-password-form";
import { LogoutButton } from "@/components/logout-button";

export const metadata: Metadata = {
  title: "Change password | Sunday Survivor Picks",
};

export default function ChangePasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">
            Security
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-stone-900">
            Change password
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            Your temporary password must be replaced before you can use the
            league.
          </p>
        </div>
        <LogoutButton />
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white/90 p-6 shadow-sm">
        <ChangePasswordForm />
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountSettingsForms } from "@/app/account/account-settings-forms";
import { loadAccountSettings } from "@/lib/account/settings";
import { MemberManagementError } from "@/lib/members/validation";

export const metadata: Metadata = {
  title: "Account | Sunday Survivor Picks",
  description: "Update your display name, email, and password.",
};

export default async function AccountPage() {
  let snapshot;
  try {
    snapshot = await loadAccountSettings();
  } catch (error) {
    if (error instanceof MemberManagementError) {
      if (error.code === "unauthorized") {
        redirect("/login");
      }
      if (error.code === "forbidden") {
        redirect("/change-password");
      }
    }
    throw error;
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-6 sm:py-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">
          Account
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-stone-900">
          Settings
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Manage your display name, email, and password. This page cannot change
          league roles, membership, or picks.
        </p>
        <Link
          href="/"
          className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-emerald-900"
        >
          ← Back to dashboard
        </Link>
      </div>

      <AccountSettingsForms
        displayName={snapshot.displayName}
        email={snapshot.email}
        pendingEmail={snapshot.pendingEmail}
      />
    </main>
  );
}

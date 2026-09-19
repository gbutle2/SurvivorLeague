import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountSettingsForms } from "@/app/account/account-settings-forms";
import { AppShell } from "@/components/app-shell";
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
    <AppShell
      title="Account settings"
      subtitle="Manage your display name, email, and password. This page cannot change league roles, membership, or picks."
    >
      <AccountSettingsForms
        displayName={snapshot.displayName}
        email={snapshot.email}
        pendingEmail={snapshot.pendingEmail}
      />
    </AppShell>
  );
}

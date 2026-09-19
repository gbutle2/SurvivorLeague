"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  changeOwnPassword,
  requestOwnEmailChange,
  updateOwnDisplayName,
} from "@/lib/account/settings";
import { mapMemberErrorForUi } from "@/lib/members/validation";

export type AccountFormState = {
  error: string | null;
  success: string | null;
};

const empty: AccountFormState = {
  error: null,
  success: null,
};

function refreshAccountSurfaces(): void {
  revalidatePath("/account");
  revalidatePath("/");
}

export async function updateDisplayNameAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  try {
    // Submitted user ids are ignored — session decides the target.
    void formData.get("user_id");
    const result = await updateOwnDisplayName({
      displayName: String(formData.get("display_name") ?? ""),
      submittedUserId: String(formData.get("user_id") ?? "") || null,
    });
    refreshAccountSurfaces();
    return {
      error: null,
      success: `Display name updated to ${result.displayName}.`,
    };
  } catch (error) {
    return { ...empty, error: mapMemberErrorForUi(error) };
  }
}

export async function updateEmailAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  try {
    void formData.get("user_id");
    void formData.get("current_email");
    const result = await requestOwnEmailChange({
      newEmail: String(formData.get("new_email") ?? ""),
      currentPassword: String(formData.get("current_password") ?? ""),
      submittedUserId: String(formData.get("user_id") ?? "") || null,
      submittedCurrentEmail: String(formData.get("current_email") ?? "") || null,
    });
    refreshAccountSurfaces();
    return {
      error: null,
      success: `Verification email sent. ${result.currentEmail} stays active until you confirm ${result.pendingEmail}. Check the new inbox (and your current inbox if Secure Email Change asks you to confirm both).`,
    };
  } catch (error) {
    return { ...empty, error: mapMemberErrorForUi(error) };
  }
}

export async function updatePasswordAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  try {
    void formData.get("user_id");
    await changeOwnPassword({
      currentPassword: String(formData.get("current_password") ?? ""),
      newPassword: String(formData.get("new_password") ?? ""),
      confirmPassword: String(formData.get("confirm_password") ?? ""),
      submittedUserId: String(formData.get("user_id") ?? "") || null,
    });
  } catch (error) {
    return { ...empty, error: mapMemberErrorForUi(error) };
  }

  // Fixed destination — no open redirect.
  redirect("/login?message=password-updated");
}

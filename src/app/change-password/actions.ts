"use server";

import { redirect } from "next/navigation";

import { completeForcedPasswordChange } from "@/lib/members/password-change";
import { mapMemberErrorForUi } from "@/lib/members/validation";

export type ChangePasswordState = {
  error: string | null;
};

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  try {
    await completeForcedPasswordChange({ newPassword, confirmPassword });
  } catch (error) {
    return { error: mapMemberErrorForUi(error) };
  }

  redirect("/login?message=password-updated");
}

import "server-only";

import {
  MemberManagementError,
  logMemberError,
  mustChangePasswordFromMetadata,
  validateNewPassword,
} from "@/lib/members/validation";
import { createAdminClient, isAdminConfigError } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Complete forced password change for a temporary-password user.
 * Clears must_change_password via Admin API only (not browser client).
 */
export async function completeForcedPasswordChange(input: {
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  if (input.newPassword !== input.confirmPassword) {
    throw new MemberManagementError(
      "password_mismatch",
      "New password and confirmation do not match.",
    );
  }

  const policyError = validateNewPassword(input.newPassword);
  if (policyError) {
    throw new MemberManagementError("invalid_password", policyError);
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new MemberManagementError("unauthorized", "Sign in to continue.");
  }

  if (!mustChangePasswordFromMetadata(user.app_metadata)) {
    throw new MemberManagementError(
      "forbidden",
      "Your password does not require a forced change.",
    );
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: input.newPassword,
  });

  if (updateError) {
    logMemberError("password_change", "USER_PASSWORD_UPDATE_FAILED");
    throw new MemberManagementError(
      "unexpected",
      "Could not update your password. Try a different password.",
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    if (isAdminConfigError(error)) {
      throw new MemberManagementError(
        "config",
        "Password finalization is not configured on this server.",
      );
    }
    throw error;
  }

  const { error: metaError } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...user.app_metadata,
      must_change_password: false,
    },
  });

  if (metaError) {
    logMemberError("password_change", "APP_METADATA_CLEAR_FAILED");
    throw new MemberManagementError(
      "unexpected",
      "Password was updated, but the account flag could not be cleared. Contact the commissioner.",
    );
  }

  await supabase.auth.signOut();
}

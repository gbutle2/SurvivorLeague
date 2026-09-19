import "server-only";

import {
  interpretEmailChangeResponse,
  mapEmailProviderConflict,
  prepareDisplayName,
  prepareNewEmail,
  prepareNewPassword,
  resolveAccountTargetUserId,
} from "@/lib/account/rules";
import {
  MemberManagementError,
  logMemberError,
  mustChangePasswordFromMetadata,
  normalizeEmail,
} from "@/lib/members/validation";
import { requireMutationRow } from "@/lib/mutations/result";
import { createClient } from "@/lib/supabase/server";

export type AccountProfileSnapshot = {
  userId: string;
  displayName: string;
  email: string | null;
  pendingEmail: string | null;
};

/**
 * Load the authenticated user's account settings snapshot.
 * Session identity only — never from form input.
 */
export async function loadAccountSettings(): Promise<AccountProfileSnapshot> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new MemberManagementError("unauthorized", "Sign in to continue.");
  }

  if (mustChangePasswordFromMetadata(user.app_metadata)) {
    throw new MemberManagementError(
      "forbidden",
      "Finish changing your temporary password before opening Account Settings.",
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    logMemberError("account_settings", "PROFILE_LOAD_FAILED");
    throw new MemberManagementError(
      "unexpected",
      "Could not load your account settings.",
    );
  }

  return {
    userId: user.id,
    displayName:
      profile?.display_name ??
      (typeof user.user_metadata?.display_name === "string"
        ? user.user_metadata.display_name
        : null) ??
      user.email?.split("@")[0] ??
      "Player",
    email: user.email ?? null,
    pendingEmail:
      typeof user.new_email === "string" && user.new_email.length > 0
        ? user.new_email
        : null,
  };
}

async function requirePermanentPasswordUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new MemberManagementError("unauthorized", "Sign in to continue.");
  }

  if (mustChangePasswordFromMetadata(user.app_metadata)) {
    throw new MemberManagementError(
      "forbidden",
      "Finish changing your temporary password before updating account settings.",
    );
  }

  return { supabase, user };
}

/**
 * Reauthenticate the signed-in user with their current password.
 * Uses the session email only — never a submitted email as identity.
 */
export async function reauthenticateCurrentUser(input: {
  currentPassword: string;
  /** Ignored — session email is authoritative. */
  submittedEmail?: string | null;
}): Promise<void> {
  void input.submittedEmail;
  const { supabase, user } = await requirePermanentPasswordUser();

  if (!user.email) {
    throw new MemberManagementError(
      "unexpected",
      "Your account does not have a confirmed email address.",
    );
  }

  if (!input.currentPassword) {
    throw new MemberManagementError(
      "invalid_password",
      "Enter your current password.",
    );
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: input.currentPassword,
  });

  if (error) {
    throw new MemberManagementError(
      "unauthorized",
      "Current password is incorrect.",
    );
  }
}

export async function updateOwnDisplayName(input: {
  displayName: string;
  /** Ignored — session user is the only allowed target. */
  submittedUserId?: string | null;
}): Promise<{ displayName: string }> {
  const { supabase, user } = await requirePermanentPasswordUser();
  const userId = resolveAccountTargetUserId(user.id, input.submittedUserId);
  const displayName = prepareDisplayName(input.displayName);

  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", userId)
    .select("id, display_name")
    .maybeSingle();

  if (error) {
    logMemberError("account_settings", "PROFILE_UPDATE_FAILED");
    throw new MemberManagementError(
      "unexpected",
      "Could not update your display name.",
    );
  }

  const verified = requireMutationRow(
    data,
    "Your display name was not changed. Refresh and try again.",
  );
  if (!verified.ok) {
    throw new MemberManagementError("unexpected", verified.error);
  }

  if (verified.row.id !== userId || verified.row.display_name !== displayName) {
    throw new MemberManagementError(
      "unexpected",
      "Your display name was not changed. Refresh and try again.",
    );
  }

  const { error: metaError } = await supabase.auth.updateUser({
    data: { display_name: displayName },
  });
  if (metaError) {
    logMemberError("account_settings", "USER_METADATA_SYNC_FAILED");
    throw new MemberManagementError(
      "unexpected",
      "Display name was saved, but account metadata could not be synchronized. Refresh and try again.",
    );
  }

  return { displayName };
}

export type EmailChangeResult = {
  currentEmail: string;
  pendingEmail: string;
};

/**
 * Request an email change for the authenticated user via Supabase Auth.
 * Does not treat the email as changed until Auth confirmation completes.
 */
export async function requestOwnEmailChange(input: {
  newEmail: string;
  currentPassword: string;
  /** Ignored — session user is the only allowed target. */
  submittedUserId?: string | null;
  /** Ignored — session email is used for reauthentication. */
  submittedCurrentEmail?: string | null;
}): Promise<EmailChangeResult> {
  void input.submittedUserId;
  void input.submittedCurrentEmail;

  await reauthenticateCurrentUser({
    currentPassword: input.currentPassword,
  });

  const { supabase, user } = await requirePermanentPasswordUser();
  const currentEmail = user.email;
  if (!currentEmail) {
    throw new MemberManagementError(
      "unexpected",
      "Your account does not have a confirmed email address.",
    );
  }

  const newEmail = prepareNewEmail(input.newEmail, currentEmail);

  const { data, error } = await supabase.auth.updateUser({
    email: newEmail,
  });

  if (error) {
    if (mapEmailProviderConflict(error.message ?? "")) {
      throw new MemberManagementError(
        "duplicate_email",
        "That email cannot be used. Try a different address.",
      );
    }
    logMemberError("account_settings", "EMAIL_UPDATE_FAILED");
    throw new MemberManagementError(
      "unexpected",
      "Could not start the email change. Try again shortly.",
    );
  }

  const updated = data.user;
  if (!updated) {
    throw new MemberManagementError(
      "unexpected",
      "Could not start the email change. Try again shortly.",
    );
  }

  return interpretEmailChangeResponse({
    requestedEmail: newEmail,
    previousEmail: currentEmail,
    updatedEmail: updated.email,
    newEmail: updated.new_email,
  });
}

/**
 * Change the authenticated user's password via the user Auth API.
 * Signs out the current session on success. Does not claim other sessions are revoked.
 */
export async function changeOwnPassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  /** Ignored — session user is the only allowed target. */
  submittedUserId?: string | null;
}): Promise<void> {
  void input.submittedUserId;

  prepareNewPassword({
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    confirmPassword: input.confirmPassword,
  });

  await reauthenticateCurrentUser({
    currentPassword: input.currentPassword,
  });

  const { supabase } = await requirePermanentPasswordUser();
  const { error } = await supabase.auth.updateUser({
    password: input.newPassword,
  });

  if (error) {
    logMemberError("account_settings", "PASSWORD_UPDATE_FAILED");
    throw new MemberManagementError(
      "unexpected",
      "Could not update your password. Try a different password.",
    );
  }

  await supabase.auth.signOut();
}

/** Exported for tests that assert email normalization in account flows. */
export { normalizeEmail };

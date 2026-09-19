"use server";

import { revalidatePath } from "next/cache";

import {
  createPlayerAccount,
  listLeagueMembers,
  resetPlayerTemporaryPassword,
  setMemberActive,
} from "@/lib/members/manage";
import { mapMemberErrorForUi } from "@/lib/members/validation";

export type MembersActionState = {
  error: string | null;
  success: string | null;
  temporaryPassword: string | null;
  createdEmail: string | null;
  createdDisplayName: string | null;
};

const empty: MembersActionState = {
  error: null,
  success: null,
  temporaryPassword: null,
  createdEmail: null,
  createdDisplayName: null,
};

const MEMBERS_PATH = "/commissioner/members";

function refreshMembersPage(): void {
  revalidatePath(MEMBERS_PATH);
}

export async function loadMembersForPage() {
  return listLeagueMembers();
}

export async function createPlayerAction(
  _prev: MembersActionState,
  formData: FormData,
): Promise<MembersActionState> {
  try {
    // Submitted league/role/requester fields are intentionally ignored.
    void formData.get("league_id");
    void formData.get("requester_id");
    void formData.get("role");

    const temporaryPassword = String(formData.get("temporary_password") ?? "");
    const temporaryPasswordConfirmation = String(
      formData.get("temporary_password_confirmation") ?? "",
    );

    if (temporaryPassword !== temporaryPasswordConfirmation) {
      return {
        ...empty,
        error: "Temporary password and confirmation must match.",
      };
    }

    const result = await createPlayerAccount({
      email: String(formData.get("email") ?? ""),
      displayName: String(formData.get("display_name") ?? ""),
      temporaryPassword,
      leagueId: String(formData.get("league_id") ?? "") || null,
    });

    // Revalidate list/count; return value still carries the one-time password.
    refreshMembersPage();

    return {
      error: null,
      success: `Created ${result.displayName}. Share the temporary password now — it is shown only once.`,
      temporaryPassword: result.temporaryPassword,
      createdEmail: result.email,
      createdDisplayName: result.displayName,
    };
  } catch (error) {
    return {
      ...empty,
      error: mapMemberErrorForUi(error),
    };
  }
}

export async function resetPasswordAction(
  _prev: MembersActionState,
  formData: FormData,
): Promise<MembersActionState> {
  try {
    void formData.get("league_id");
    const targetUserId = String(formData.get("user_id") ?? "");
    const temporaryPassword = String(formData.get("temporary_password") ?? "");
    const temporaryPasswordConfirmation = String(
      formData.get("temporary_password_confirmation") ?? "",
    );

    if (temporaryPassword !== temporaryPasswordConfirmation) {
      return {
        ...empty,
        error: "Temporary password and confirmation must match.",
      };
    }

    const result = await resetPlayerTemporaryPassword({
      targetUserId,
      temporaryPassword,
    });

    // Password status flips to temporary — refresh the member list.
    refreshMembersPage();

    return {
      error: null,
      success:
        "Temporary password reset. Share it now — it is shown only once.",
      temporaryPassword: result.temporaryPassword,
      createdEmail: result.email,
      createdDisplayName: result.displayName,
    };
  } catch (error) {
    return {
      ...empty,
      error: mapMemberErrorForUi(error),
    };
  }
}

export async function deactivateMemberAction(
  _prev: MembersActionState,
  formData: FormData,
): Promise<MembersActionState> {
  try {
    const confirmed = String(formData.get("confirm") ?? "") === "yes";
    if (!confirmed) {
      return { ...empty, error: "Confirm deactivation to continue." };
    }
    await setMemberActive({
      targetUserId: String(formData.get("user_id") ?? ""),
      active: false,
    });
    refreshMembersPage();
    return {
      ...empty,
      success:
        "Player deactivated. Account and pick history are preserved.",
    };
  } catch (error) {
    return { ...empty, error: mapMemberErrorForUi(error) };
  }
}

export async function reactivateMemberAction(
  _prev: MembersActionState,
  formData: FormData,
): Promise<MembersActionState> {
  try {
    await setMemberActive({
      targetUserId: String(formData.get("user_id") ?? ""),
      active: true,
    });
    refreshMembersPage();
    return {
      ...empty,
      success: "Player reactivated. Password was not changed.",
    };
  } catch (error) {
    return { ...empty, error: mapMemberErrorForUi(error) };
  }
}

export async function dismissTempPasswordAction(): Promise<MembersActionState> {
  return empty;
}

"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  updateDisplayNameAction,
  updateEmailAction,
  updatePasswordAction,
  type AccountFormState,
} from "@/app/account/actions";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
} from "@/lib/members/password-policy";

const initial: AccountFormState = {
  error: null,
  success: null,
};

type AccountSettingsFormsProps = {
  displayName: string;
  email: string | null;
  pendingEmail: string | null;
};

export function AccountSettingsForms({
  displayName,
  email,
  pendingEmail,
}: AccountSettingsFormsProps) {
  const [nameState, nameAction, namePending] = useActionState(
    updateDisplayNameAction,
    initial,
  );
  const [emailState, emailAction, emailPending] = useActionState(
    updateEmailAction,
    initial,
  );
  const [passwordState, passwordAction, passwordPending] = useActionState(
    updatePasswordAction,
    initial,
  );

  const emailFormRef = useRef<HTMLFormElement>(null);
  const passwordFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (emailState.error || emailState.success) {
      emailFormRef.current?.reset();
    }
  }, [emailState.error, emailState.success]);

  useEffect(() => {
    if (passwordState.error || passwordState.success) {
      passwordFormRef.current?.reset();
    }
  }, [passwordState.error, passwordState.success]);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-stone-900">Profile</h2>
        <p className="mt-1 text-sm text-stone-600">
          Current name:{" "}
          <span className="font-medium text-stone-800">{displayName}</span>
        </p>
        <form action={nameAction} className="mt-4 flex flex-col gap-3">
          <label
            htmlFor="display_name"
            className="flex flex-col gap-1.5 text-sm font-medium text-stone-700"
          >
            Display name
            <input
              id="display_name"
              name="display_name"
              defaultValue={displayName}
              required
              maxLength={40}
              autoComplete="nickname"
              className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/30"
            />
          </label>
          <FormStatus state={nameState} />
          <button
            type="submit"
            disabled={namePending}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {namePending ? "Saving…" : "Save name"}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-stone-900">Email</h2>
        <p className="mt-1 text-sm text-stone-600">
          Current email:{" "}
          <span className="font-medium text-stone-800">
            {email ?? "Unavailable"}
          </span>
        </p>
        {pendingEmail ? (
          <p className="mt-2 text-sm text-amber-900">
            Pending confirmation for {pendingEmail}. Your current email stays
            active until confirmation finishes.
          </p>
        ) : null}
        <p className="mt-2 text-xs leading-relaxed text-stone-500">
          Confirmation is required before the new address becomes active. Check
          the new inbox; if Secure Email Change is on, confirm from both
          addresses.
        </p>
        <form
          ref={emailFormRef}
          action={emailAction}
          className="mt-4 flex flex-col gap-3"
        >
          <label
            htmlFor="new_email"
            className="flex flex-col gap-1.5 text-sm font-medium text-stone-700"
          >
            New email
            <input
              id="new_email"
              name="new_email"
              type="email"
              required
              autoComplete="email"
              className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/30"
            />
          </label>
          <label
            htmlFor="email_current_password"
            className="flex flex-col gap-1.5 text-sm font-medium text-stone-700"
          >
            Current password
            <input
              id="email_current_password"
              name="current_password"
              type="password"
              required
              autoComplete="current-password"
              className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/30"
            />
          </label>
          <FormStatus state={emailState} />
          <button
            type="submit"
            disabled={emailPending}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {emailPending ? "Sending…" : "Send verification email"}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-stone-900">Password</h2>
        <p className="mt-1 text-sm text-stone-600">
          Changing your password signs you out of this device. Sign in again
          with the new password.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-stone-500">
          {PASSWORD_POLICY_HINT}
        </p>
        <form
          ref={passwordFormRef}
          action={passwordAction}
          className="mt-4 flex flex-col gap-3"
        >
          <label
            htmlFor="password_current"
            className="flex flex-col gap-1.5 text-sm font-medium text-stone-700"
          >
            Current password
            <input
              id="password_current"
              name="current_password"
              type="password"
              required
              autoComplete="current-password"
              className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/30"
            />
          </label>
          <label
            htmlFor="new_password"
            className="flex flex-col gap-1.5 text-sm font-medium text-stone-700"
          >
            New password
            <input
              id="new_password"
              name="new_password"
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/30"
            />
          </label>
          <label
            htmlFor="confirm_password"
            className="flex flex-col gap-1.5 text-sm font-medium text-stone-700"
          >
            Confirm new password
            <input
              id="confirm_password"
              name="confirm_password"
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/30"
            />
          </label>
          <FormStatus state={passwordState} />
          <button
            type="submit"
            disabled={passwordPending}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {passwordPending ? "Updating…" : "Change password"}
          </button>
        </form>
      </section>
    </div>
  );
}

function FormStatus({ state }: { state: AccountFormState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
      >
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p
        role="status"
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950"
      >
        {state.success}
      </p>
    );
  }
  return null;
}

import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in | Sunday Survivor Picks",
  description: "Sign in to your private survivor league.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const params = await searchParams;
  const passwordUpdated = params.message === "password-updated";

  return (
    <main className="flex min-h-full flex-1 flex-col justify-center px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">
            Private league
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-stone-900">
            Sunday Survivor Picks
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            Sign in with the account created by your commissioner.
          </p>
        </div>

        {passwordUpdated ? (
          <p
            role="status"
            className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-950"
          >
            Password updated. Sign in with your new password.
          </p>
        ) : null}

        <div className="rounded-2xl border border-stone-200 bg-white/90 p-6 shadow-sm backdrop-blur">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}

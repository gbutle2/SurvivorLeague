import { logout } from "@/app/actions/auth";

export function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 active:bg-stone-50"
      >
        Log out
      </button>
    </form>
  );
}

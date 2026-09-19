"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useReducer,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { logout } from "@/app/actions/auth";
import {
  accountInitials,
  accountMenuTriggerAria,
  accountTriggerLabel,
  reduceAccountMenuUi,
} from "@/lib/account/menu-identity";

type AccountMenuProps = {
  displayName: string | null;
  email: string | null;
};

export function AccountMenu({ displayName, email }: AccountMenuProps) {
  const [state, dispatch] = useReducer(reduceAccountMenuUi, { open: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const initials = accountInitials(displayName);
  const triggerName = accountTriggerLabel(displayName);
  const aria = accountMenuTriggerAria(state.open);

  useEffect(() => {
    if (!state.open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      dispatch({ type: "outside" });
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "escape" });
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [state.open]);

  function onTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    dispatch({ type: "toggle" });
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" && !state.open) {
      event.preventDefault();
      dispatch({ type: "open" });
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-full border border-stone-300 bg-white py-1 pl-1 pr-1 text-sm font-medium text-stone-800 transition hover:border-emerald-700/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 sm:pr-3"
        aria-expanded={aria["aria-expanded"]}
        aria-haspopup={aria["aria-haspopup"]}
        aria-controls={state.open ? menuId : undefined}
        aria-label={aria["aria-label"]}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
      >
        <span
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-800 text-sm font-semibold text-white"
          aria-hidden="true"
        >
          {initials ? initials : <PersonIcon />}
        </span>
        {triggerName ? (
          <span className="hidden max-w-[9rem] truncate sm:inline">
            {triggerName}
          </span>
        ) : null}
      </button>

      {state.open ? (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white p-2 shadow-lg"
        >
          <div className="border-b border-stone-100 px-3 py-2">
            <p className="truncate text-sm font-semibold text-stone-900">
              {triggerName ?? "Account"}
            </p>
            <p className="truncate text-xs text-stone-600">
              {email ?? "Email unavailable"}
            </p>
          </div>
          <Link
            href="/account"
            role="menuitem"
            className="mt-1 flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-stone-800 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
            onClick={() => dispatch({ type: "select" })}
          >
            Account settings
          </Link>
          <form action={logout} className="mt-1">
            <button
              type="submit"
              role="menuitem"
              className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-stone-800 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
              onClick={() => dispatch({ type: "select" })}
            >
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function PersonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="3.2" />
      <path
        d="M5.5 18.5c1.6-3 4-4.5 6.5-4.5s4.9 1.5 6.5 4.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

"use client";

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { AlertsTab } from "@/components/communication/alerts-tab";
import { DmsTab } from "@/components/communication/dms-tab";
import { LeagueTab } from "@/components/communication/league-tab";
import type { CommTab } from "@/lib/communication/types";

type CommunicationOverlayProps = {
  open: boolean;
  onClose: () => void;
  tab: CommTab;
  onTabChange: (tab: CommTab) => void;
  leagueId: string;
  userId: string;
  leagueConversationId: string | null;
  onUnreadChange: () => void;
};

const TABS: { id: CommTab; label: string }[] = [
  { id: "league", label: "League" },
  { id: "dms", label: "DMs" },
  { id: "alerts", label: "Alerts" },
];

export function CommunicationOverlay({
  open,
  onClose,
  tab,
  onTabChange,
  leagueId,
  userId,
  leagueConversationId,
  onUnreadChange,
}: CommunicationOverlayProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end sm:items-stretch">
      <button
        type="button"
        aria-label="Close communication panel"
        className="absolute inset-0 bg-stone-900/40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={trapFocus}
        className="relative z-10 flex h-[90vh] w-full flex-col rounded-t-2xl border border-stone-200 bg-stone-50 shadow-xl sm:h-full sm:w-[400px] sm:max-w-[400px] sm:rounded-none sm:border-l sm:border-t-0 sm:border-r-0 sm:border-b-0"
      >
        <header className="flex items-center justify-between gap-2 border-b border-stone-200 px-3 py-2">
          <h2
            id={titleId}
            className="font-display text-lg font-bold tracking-tight text-stone-900"
          >
            Messages
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div
          role="tablist"
          aria-label="Communication sections"
          className="flex border-b border-stone-200"
        >
          {TABS.map((item) => {
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                id={`comm-tab-${item.id}`}
                tabIndex={selected ? 0 : -1}
                className={`min-h-11 flex-1 px-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-800 ${
                  selected
                    ? "border-b-2 border-emerald-800 text-emerald-900"
                    : "text-stone-500 hover:text-stone-800"
                }`}
                onClick={() => onTabChange(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          aria-labelledby={`comm-tab-${tab}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          {tab === "league" ? (
            <LeagueTab
              leagueId={leagueId}
              userId={userId}
              conversationId={leagueConversationId}
              active={open && tab === "league"}
              onUnreadChange={onUnreadChange}
            />
          ) : null}
          {tab === "dms" ? (
            <DmsTab
              leagueId={leagueId}
              userId={userId}
              active={open && tab === "dms"}
              onUnreadChange={onUnreadChange}
            />
          ) : null}
          {tab === "alerts" ? (
            <AlertsTab
              leagueId={leagueId}
              userId={userId}
              active={open && tab === "alerts"}
              onCloseOverlay={onClose}
              onUnreadChange={onUnreadChange}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

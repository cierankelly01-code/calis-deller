"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";

// Deterrent-level gate for the settings screens: stops staff casually
// changing units/staff/tasks, nothing more. The PIN is inlined into the
// client bundle (NEXT_PUBLIC_*) so this is NOT cryptographic security —
// the real tamper protection is the database's append-only RLS, which
// no UI can bypass. Log screens stay login-free by design.

const PIN = process.env.NEXT_PUBLIC_ADMIN_PIN ?? "";
const SESSION_KEY = "cd-admin-pin-ok";

function isUnlocked(): boolean {
  // No PIN configured → gate off (dev convenience; set NEXT_PUBLIC_ADMIN_PIN in prod).
  if (!PIN) return true;
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return true;
  }
}

export function PinGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState<boolean | null>(null); // null until client mount
  const [entered, setEntered] = useState("");
  const [wrong, setWrong] = useState(false);

  // Resolve after mount — sessionStorage isn't available during prerender,
  // and deciding in an effect keeps hydration consistent (server & first
  // client render both produce null). The set-state-in-effect rule is
  // relaxed here because reading browser-only storage after mount is
  // exactly what effects are for.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnlocked(isUnlocked());
  }, []);

  if (unlocked === null) return null;
  if (unlocked) return <>{children}</>;

  function press(digit: string) {
    setWrong(false);
    const next = (entered + digit).slice(0, PIN.length);
    setEntered(next);
    if (next.length === PIN.length) {
      if (next === PIN) {
        try {
          sessionStorage.setItem(SESSION_KEY, "1");
        } catch {
          // Session-only unlock still works via state below.
        }
        setUnlocked(true);
      } else {
        setEntered("");
        setWrong(true);
      }
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Settings" />
      <div className="flex-1 px-4 py-10 max-w-xs w-full mx-auto text-center space-y-6">
        <div>
          <p className="text-4xl mb-2">🔒</p>
          <p className="font-bold text-ink">Manager PIN required</p>
          <p className="text-sm text-ink-soft mt-1">
            Settings change what staff see. Daily checks don&apos;t need a PIN.
          </p>
        </div>

        <div className="flex justify-center gap-3" aria-label="PIN entry" aria-live="polite">
          {Array.from({ length: PIN.length }).map((_, i) => (
            <span
              key={i}
              className={`h-4 w-4 rounded-full border ${
                i < entered.length ? "bg-ink border-ink" : "border-ink-faint"
              }`}
            />
          ))}
        </div>

        {wrong && (
          <p className="text-danger font-medium text-sm" role="alert">
            Wrong PIN — try again.
          </p>
        )}

        <div className="grid grid-cols-3 gap-2.5">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => press(d)}
              className="h-16 rounded-2xl text-2xl font-semibold bg-surface text-ink shadow-sm border border-line active:bg-paper active:scale-95 transition-all"
            >
              {d}
            </button>
          ))}
          <div aria-hidden />
          <button
            type="button"
            onClick={() => press("0")}
            className="h-16 rounded-2xl text-2xl font-semibold bg-surface text-ink shadow-sm border border-line active:bg-paper active:scale-95 transition-all"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => {
              setEntered(entered.slice(0, -1));
              setWrong(false);
            }}
            aria-label="Delete last digit"
            className="h-16 rounded-2xl text-2xl font-semibold bg-paper text-ink-soft border border-line active:scale-95 transition-all"
          >
            ⌫
          </button>
        </div>
      </div>
    </div>
  );
}

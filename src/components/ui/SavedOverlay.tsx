"use client";

// Big unmissable confirmation — a staff member glancing from arm's length
// needs more than a button label swap to trust the entry went in.
export function SavedOverlay({ show, message = "Saved" }: { show: boolean; message?: string }) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/25" role="status">
      <div className="rounded-3xl bg-surface border border-line shadow-xl px-12 py-9 text-center saved-pop">
        <div className="mx-auto h-16 w-16 rounded-full bg-brand text-white grid place-items-center text-3xl">
          ✓
        </div>
        <p className="mt-4 text-xl font-bold text-ink">{message}</p>
      </div>
    </div>
  );
}

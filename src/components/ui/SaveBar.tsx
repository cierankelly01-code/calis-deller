"use client";

// Sticky action bar — the save button must never be below the fold when a
// staff member is standing at a fridge with the door open.
export function SaveBar({
  disabled,
  saving,
  saved,
  onSave,
  label = "Save",
  hint,
}: {
  disabled: boolean;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  label?: string;
  hint?: string | null;
}) {
  return (
    <div className="sticky bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="max-w-2xl w-full mx-auto">
        {hint && <p className="text-sm text-ink-soft text-center mb-2">{hint}</p>}
        <button
          type="button"
          disabled={disabled}
          onClick={onSave}
          className="w-full h-14 rounded-2xl bg-brand text-white text-lg font-semibold shadow-sm active:bg-brand-deep active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saved ? "Saved ✓" : saving ? "Saving…" : label}
        </button>
      </div>
    </div>
  );
}

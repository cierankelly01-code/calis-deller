"use client";

type NumberPadProps = {
  value: string;
  onChange: (value: string) => void;
  allowNegative?: boolean;
  suffix?: string;
  maxLength?: number;
};

const MAX_LENGTH_DEFAULT = 6;

function PadButton({
  onClick,
  children,
  wide,
  variant = "default",
  label,
}: {
  onClick: () => void;
  children: React.ReactNode;
  wide?: boolean;
  variant?: "default" | "muted";
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`${wide ? "col-span-3" : ""} h-16 rounded-2xl text-2xl font-semibold transition-all active:scale-95 ${
        variant === "muted"
          ? "bg-paper text-ink-soft border border-line"
          : "bg-surface text-ink shadow-sm border border-line active:bg-paper"
      }`}
    >
      {children}
    </button>
  );
}

// Deliberately not the OS keyboard: a fixed on-screen layout avoids
// autocorrect/predictive text and keeps entry speed consistent across staff.
export function NumberPad({
  value,
  onChange,
  allowNegative = false,
  suffix,
  maxLength = MAX_LENGTH_DEFAULT,
}: NumberPadProps) {
  const isNegative = value.startsWith("-");
  const digits = isNegative ? value.slice(1) : value;

  function setDigits(nextDigits: string) {
    if (nextDigits.replace(".", "").length > maxLength) return;
    onChange(isNegative ? `-${nextDigits}` : nextDigits);
  }

  function appendDigit(d: number) {
    if (digits === "0") {
      setDigits(String(d));
      return;
    }
    setDigits(digits + String(d));
  }

  function appendDecimal() {
    if (digits.includes(".")) return;
    setDigits(digits === "" ? "0." : digits + ".");
  }

  function backspace() {
    setDigits(digits.slice(0, -1));
  }

  function toggleSign() {
    if (!allowNegative) return;
    onChange(isNegative ? digits : `-${digits}`);
  }

  return (
    <div className="w-full max-w-xs mx-auto">
      <output
        className="mb-4 h-20 flex items-baseline justify-center gap-1 rounded-2xl bg-ink text-paper pt-4"
        aria-live="polite"
      >
        <span className="text-5xl font-mono font-medium tabular-nums leading-none">
          {value === "" ? "–" : value}
        </span>
        {suffix && <span className="text-2xl text-ink-faint leading-none">{suffix}</span>}
      </output>
      <div className="grid grid-cols-3 gap-2.5">
        {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((d) => (
          <PadButton key={d} onClick={() => appendDigit(d)}>
            {d}
          </PadButton>
        ))}
        {allowNegative ? (
          <PadButton variant="muted" onClick={toggleSign} label="Plus or minus">
            ±
          </PadButton>
        ) : (
          <div aria-hidden />
        )}
        <PadButton onClick={() => appendDigit(0)}>0</PadButton>
        <PadButton variant="muted" onClick={appendDecimal} label="Decimal point">
          .
        </PadButton>
        <PadButton wide variant="muted" onClick={backspace} label="Delete last digit">
          ⌫ Delete
        </PadButton>
      </div>
    </div>
  );
}

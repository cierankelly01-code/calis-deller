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
}: {
  onClick: () => void;
  children: React.ReactNode;
  wide?: boolean;
  variant?: "default" | "muted";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${wide ? "col-span-3" : ""} h-16 rounded-xl text-2xl font-semibold active:scale-95 transition-transform ${
        variant === "muted"
          ? "bg-zinc-200 text-zinc-700"
          : "bg-white text-zinc-900 shadow-sm border border-zinc-200"
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
      <div className="mb-4 h-16 flex items-center justify-center rounded-xl bg-zinc-900 text-white text-4xl font-mono tabular-nums">
        {value === "" ? "0" : value}
        {suffix && <span className="ml-1 text-2xl text-zinc-400">{suffix}</span>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((d) => (
          <PadButton key={d} onClick={() => appendDigit(d)}>
            {d}
          </PadButton>
        ))}
        <PadButton variant="muted" onClick={toggleSign}>
          {allowNegative ? "±" : ""}
        </PadButton>
        <PadButton onClick={() => appendDigit(0)}>0</PadButton>
        <PadButton variant="muted" onClick={appendDecimal}>
          .
        </PadButton>
        <PadButton wide variant="muted" onClick={backspace}>
          ⌫ Delete
        </PadButton>
      </div>
    </div>
  );
}

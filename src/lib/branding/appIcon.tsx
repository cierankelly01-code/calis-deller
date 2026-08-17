import type { CSSProperties } from "react";

// Shared visual for generated favicon / apple-touch-icon / manifest icons.
// Placeholder monogram — swap for a real logo when the owner has one.
export function AppIconGlyph({ fontSize }: { fontSize: number }) {
  const style: CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0f766e",
    color: "#ffffff",
    fontFamily: "sans-serif",
    fontWeight: 700,
    fontSize,
    letterSpacing: -1,
  };
  return <div style={style}>KD</div>;
}

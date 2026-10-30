// One drawn icon set for the whole app, instead of emoji: same line weight,
// same size, same colour as the text around it. Emoji render differently on
// every iPad and made the app look like a template.

const PATHS = {
  fridge: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M5 10h14 M9 5v2 M9 13v3",
  flame: "M12 2c1 3 4.5 5 4.5 9.5a4.5 4.5 0 1 1-9 0c0-2 .8-3.3 2-4.5.2 1.8 1 2.8 2 3.2-.3-3 .2-5.6.5-8.2z",
  truck: "M2 6h12v10H2z M14 10h4l3 3v3h-7 M7 18.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z M19 18.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z",
  sparkle: "M11 3l1.8 4.6L17.5 9.5l-4.7 1.9L11 16l-1.8-4.6L4.5 9.5l4.7-1.9z M18.5 14l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z",
  thermometer: "M14 14.8V4a2 2 0 1 0-4 0v10.8a4 4 0 1 0 4 0z M12 9v7",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M12 7v5l3.5 2",
  drop: "M12 3s6.5 6.6 6.5 11.2a6.5 6.5 0 0 1-13 0C5.5 9.6 12 3 12 3z",
  bug: "M8 10h8v5a4 4 0 0 1-8 0z M9 10a3 3 0 0 1 6 0 M3.5 13H8 M16 13h4.5 M5 7.5l3 2.5 M19 7.5l-3 2.5 M5 19l3-2.5 M19 19l-3-2.5",
  wrench: "M14.7 6.3a4 4 0 0 0-5.3 5.2L3 17.9 6.1 21l6.4-6.4a4 4 0 0 0 5.2-5.3l-2.6 2.6-2.9-.4-.4-2.9z",
  sandwich: "M3 17.5L12 5l9 12.5z M6.5 13.5h11",
  alert: "M12 3.5l9.5 16.5h-19z M12 10v4 M12 17h.01",
  box: "M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z M3 7.5L12 12l9-4.5 M12 12v9",
  search: "M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z M20.5 20.5L16 16",
  book: "M3 4.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H3z M21 4.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H21z",
  calendar: "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M3 10h18 M8 3v4 M16 3v4",
  cap: "M2 9l10-5 10 5-10 5z M6 11v5c3.5 2.5 8.5 2.5 12 0v-5 M22 9v5",
  ill: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M8.5 16c2-1.3 5-1.3 7 0 M9 10h.01 M15 10h.01",
  shield: "M12 3l8 3v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6z M8.8 12l2.2 2.2 4.4-4.4",
  home: "M3 11l9-7.5 9 7.5 M5.5 9.5V20h13V9.5 M10 20v-5h4v5",
  check: "M4.5 12.5l5 5L19.5 7",
  cross: "M6 6l12 12 M18 6L6 18",
  chevron: "M9 5.5l6.5 6.5L9 18.5",
  back: "M15 5.5L8.5 12l6.5 6.5",
  printer: "M6 9V3h12v6 M6 18H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2 M7 14h10v7H7z",
  phone: "M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z",
  user: "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M4 21c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5",
  cog: "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M12 2.5v3 M12 18.5v3 M2.5 12h3 M18.5 12h3 M5.3 5.3l2.1 2.1 M16.6 16.6l2.1 2.1 M5.3 18.7l2.1-2.1 M16.6 7.4l2.1-2.1",
  meat: "M14.5 3.5a6 6 0 0 1 6 6c0 4-4.2 6-7.5 9.3a3.5 3.5 0 0 1-5-5C11.3 10.5 10.5 3.5 14.5 3.5z M8 18.5l-3 3 M6.5 14.5L3 18 M15 9.5h.01",
  question: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.9-.9 1.6v.3 M12 17h.01",
  snow: "M12 2.5v19 M3.8 7.2l16.4 9.6 M20.2 7.2L3.8 16.8 M9.5 4l2.5 2 2.5-2 M9.5 20l2.5-2 2.5 2",
  bin: "M4 7h16 M9.5 7V4h5v3 M6 7l1 13.5h10L18 7 M10 11v6 M14 11v6",
  arrow: "M4.5 12h15 M13.5 6l6 6-6 6",
  list: "M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01",
  people: "M14 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z M2.5 20c.7-3.5 3.6-5.5 8-5.5s7.3 2 8 5.5 M16.5 4.8a3.5 3.5 0 0 1 0 6.4 M18.5 14.8c1.6.8 2.7 2.4 3 5.2",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, className = "", strokeWidth = 2 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      {PATHS[name].split(" M").map((d, i) => <path key={i} d={i === 0 ? d : `M${d}`} />)}
    </svg>
  );
}

const TILE_TONE = {
  green: "bg-brand-soft text-brand-deep",
  gold: "bg-gold-soft text-gold-deep",
  red: "bg-danger-soft text-danger",
  ink: "bg-ink text-paper",
  plain: "bg-paper text-ink",
} as const;

// The coloured square an icon sits in on tiles and list rows.
export function IconTile({ name, tone = "green", size = "md" }: { name: IconName; tone?: keyof typeof TILE_TONE; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 rounded-2xl" : size === "sm" ? "h-9 w-9 rounded-xl" : "h-11 w-11 rounded-xl";
  return (
    <span className={`inline-grid place-items-center ${box} ${TILE_TONE[tone]}`}>
      <Icon name={name} size={size === "lg" ? 28 : size === "sm" ? 18 : 22} />
    </span>
  );
}

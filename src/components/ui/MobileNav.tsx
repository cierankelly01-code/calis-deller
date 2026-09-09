"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Today", icon: "⌂" },
  { href: "/log/fridge", label: "Check", icon: "＋" },
  { href: "/diary", label: "Diary", icon: "▤" },
  { href: "/allergens", label: "Allergens", icon: "⚠" },
] as const;

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="grid grid-cols-4 max-w-2xl mx-auto">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`min-h-16 flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors ${
                active ? "text-brand" : "text-ink-soft"
              }`}
            >
              <span className={`grid h-8 w-8 place-items-center rounded-full text-xl leading-none ${active ? "bg-brand-soft" : ""}`} aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

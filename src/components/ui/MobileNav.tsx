"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";

const items: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Today", icon: "home" },
  { href: "/methods", label: "How to", icon: "book" },
  { href: "/diary", label: "Diary", icon: "calendar" },
  { href: "/allergens", label: "Allergens", icon: "alert" },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
    >
      <div className="grid grid-cols-4 max-w-2xl mx-auto">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`min-h-16 flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors ${
                active ? "text-brand" : "text-ink-soft"
              }`}
            >
              <span className={`grid h-8 w-12 place-items-center rounded-full ${active ? "bg-brand-soft" : ""}`}>
                <Icon name={item.icon} size={22} />
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

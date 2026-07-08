"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";

const SECTIONS = [
  { href: "/settings/units", emoji: "🧊", title: "Fridges & freezers", sub: "Add, remove, set target ranges" },
  { href: "/settings/staff", emoji: "👥", title: "Staff", sub: "Who appears on the name picker" },
  { href: "/settings/cleaning", emoji: "🧽", title: "Cleaning tasks", sub: "Opening & closing checklists" },
  { href: "/settings/suppliers", emoji: "🚚", title: "Suppliers", sub: "Quick-pick list on delivery checks" },
  { href: "/allergens", emoji: "⚠️", title: "Products & allergens", sub: "Managed in the Allergen Guide" },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Settings" />
      <div className="flex-1 px-4 py-6 max-w-2xl w-full mx-auto space-y-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="flex items-center gap-4 rounded-xl bg-surface border border-line px-4 py-4 shadow-sm active:scale-[0.99]"
          >
            <span className="text-3xl">{section.emoji}</span>
            <span>
              <span className="block font-bold text-ink">{section.title}</span>
              <span className="block text-sm text-ink-soft">{section.sub}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

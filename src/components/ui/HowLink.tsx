import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

// "How do I do this?" — every task links to its safe method, so the book is
// one tap from the job, not on a shelf in another shop.
export function HowLink({ method, label = "How do I do this?" }: { method: string; label?: string }) {
  return (
    <Link
      href={`/methods/${method}`}
      className="inline-flex items-center gap-1.5 h-10 rounded-full border border-brand/30 bg-brand-soft px-3.5 text-sm font-semibold text-brand-deep active:scale-95 transition-transform print:hidden"
    >
      <Icon name="book" size={18} /> {label}
    </Link>
  );
}

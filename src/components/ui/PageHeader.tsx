import Link from "next/link";
import { SyncStatusPill } from "@/components/ui/SyncStatusPill";

export function PageHeader({ title, backHref = "/" }: { title: string; backHref?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur pt-[env(safe-area-inset-top)] print:hidden">
      <div className="flex items-center gap-3 px-4 h-[4.5rem] max-w-2xl w-full mx-auto">
        <Link
          href={backHref}
          className="h-11 w-11 shrink-0 flex items-center justify-center rounded-full bg-surface border border-line text-xl text-ink active:scale-95 transition-transform"
          aria-label="Back"
        >
          ←
        </Link>
        <h1 className="font-display text-[22px] font-semibold text-ink truncate">{title}</h1>
        <div className="ml-auto">
          <SyncStatusPill />
        </div>
      </div>
    </header>
  );
}

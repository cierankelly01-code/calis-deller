import Link from "next/link";

export function PageHeader({ title, backHref = "/" }: { title: string; backHref?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-4 border-b border-zinc-200 bg-white">
      <Link
        href={backHref}
        className="h-10 w-10 flex items-center justify-center rounded-full bg-zinc-100 text-xl"
        aria-label="Back to dashboard"
      >
        ←
      </Link>
      <h1 className="text-xl font-semibold text-zinc-900">{title}</h1>
    </div>
  );
}

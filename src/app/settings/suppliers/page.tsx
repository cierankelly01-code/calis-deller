"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { SimpleNameListManager } from "@/components/settings/SimpleNameListManager";

export default function SuppliersSettingsPage() {
  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Suppliers" backHref="/settings" />
      <div className="flex-1 px-4 py-6 max-w-2xl w-full mx-auto">
        <p className="text-sm text-zinc-500 mb-4">
          Quick-pick list on the delivery check screen. You can always type a one-off supplier
          name on the check itself.
        </p>
        <SimpleNameListManager
          table="suppliers"
          cacheKey="cd-suppliers"
          addLabel="Add"
          placeholder="New supplier's name"
        />
      </div>
    </div>
  );
}

"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { SimpleNameListManager } from "@/components/settings/SimpleNameListManager";

export default function StaffSettingsPage() {
  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Staff" backHref="/settings" />
      <div className="flex-1 px-4 py-6 max-w-2xl w-full mx-auto">
        <p className="text-sm text-zinc-500 mb-4">
          These names appear on the &ldquo;who&rsquo;s doing this?&rdquo; picker. Removing someone
          hides them from the picker — their past records are kept.
        </p>
        <SimpleNameListManager
          table="staff"
          cacheKey="cd-staff"
          addLabel="Add"
          placeholder="New staff member's name"
        />
      </div>
    </div>
  );
}

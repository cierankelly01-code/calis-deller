"use client";

import { useState } from "react";

export type StaffOption = {
  id: string;
  name: string;
};

type StaffTilePickerProps = {
  staff: StaffOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

// No passwords — accountability comes from staff picking their own name at
// the point of task on the shared kitchen iPad, not from a login flow.
// When a name is already selected (usually remembered from the last check)
// the picker collapses to a one-line "logging as" pill so repeat checks
// start one question shorter.
export function StaffTilePicker({ staff, selectedId, onSelect }: StaffTilePickerProps) {
  const [expanded, setExpanded] = useState(false);
  const selected = staff.find((s) => s.id === selectedId) ?? null;

  if (staff.length === 0) {
    return (
      <p className="text-ink-soft text-center py-6">
        No staff set up yet. Add staff under Settings &gt; Staff.
      </p>
    );
  }

  if (selected && !expanded) {
    return (
      <div className="flex items-center justify-between rounded-2xl bg-brand-soft border border-brand/20 px-4 py-3">
        <p className="font-semibold text-ink flex items-center gap-2.5">
          <span className="h-9 w-9 shrink-0 rounded-full bg-brand text-white grid place-items-center text-sm font-bold">
            {selected.name.slice(0, 1).toUpperCase()}
          </span>
          {selected.name}
        </p>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-sm font-semibold text-brand underline underline-offset-2"
        >
          Not you?
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {staff.map((person) => {
        const isSelected = person.id === selectedId;
        return (
          <button
            key={person.id}
            type="button"
            onClick={() => {
              onSelect(person.id);
              setExpanded(false);
            }}
            className={`h-20 rounded-2xl text-xl font-semibold px-3 transition-all active:scale-95 ${
              isSelected
                ? "bg-brand text-white shadow-sm"
                : "bg-surface text-ink border border-line shadow-sm"
            }`}
          >
            {person.name}
          </button>
        );
      })}
    </div>
  );
}

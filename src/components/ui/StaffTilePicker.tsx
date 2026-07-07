"use client";

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
export function StaffTilePicker({ staff, selectedId, onSelect }: StaffTilePickerProps) {
  if (staff.length === 0) {
    return (
      <p className="text-zinc-500 text-center py-6">
        No staff set up yet. Add staff under Settings &gt; Staff.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {staff.map((person) => {
        const selected = person.id === selectedId;
        return (
          <button
            key={person.id}
            type="button"
            onClick={() => onSelect(person.id)}
            className={`h-20 rounded-xl text-xl font-semibold px-3 transition-colors active:scale-95 ${
              selected
                ? "bg-teal-700 text-white"
                : "bg-white text-zinc-900 border border-zinc-200 shadow-sm"
            }`}
          >
            {person.name}
          </button>
        );
      })}
    </div>
  );
}

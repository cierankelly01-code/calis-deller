import type { IconName } from "@/components/ui/Icon";
import type { MethodGroup } from "@/lib/methods/content";

// A drawn icon per safe method (the content file's emoji are not shown).
export const GROUP_ICON: Record<MethodGroup, IconName> = { clean: "sparkle", chill: "snow", cook: "flame", cross: "drop", manage: "list" };

const BY_ID: Partial<Record<string, IconName>> = {
  "hand-washing": "drop", "washing-up": "sparkle", "chilled-storage": "fridge", "chilling-down": "clock", "sandwiches-out": "sandwich",
  "cooking-safely": "flame", "reheating": "flame", "hot-holding": "thermometer", "fit-for-work": "ill", "allergens": "alert",
  "pest-control": "bug", "maintenance": "wrench", "deliveries": "truck", "stock-control": "box", "product-recall": "search",
  "training": "cap", "customers-allergies": "people", "four-weekly-review": "calendar", "prove-it": "thermometer", "opening-closing": "home",
};

export function methodIcon(id: string, group: MethodGroup): IconName {
  return BY_ID[id] ?? GROUP_ICON[group];
}

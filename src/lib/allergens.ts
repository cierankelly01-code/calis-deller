// The 14 major allergens UK food businesses must declare (FSA).
// Keys match the CHECK constraint in supabase/migrations/0002_full_diary.sql
// — change one and you must change both.

export const ALLERGENS = [
  { key: "celery", label: "Celery", emoji: "🥬" },
  { key: "gluten", label: "Cereals w/ gluten", emoji: "🌾" },
  { key: "crustaceans", label: "Crustaceans", emoji: "🦐" },
  { key: "eggs", label: "Eggs", emoji: "🥚" },
  { key: "fish", label: "Fish", emoji: "🐟" },
  { key: "lupin", label: "Lupin", emoji: "🌸" },
  { key: "milk", label: "Milk", emoji: "🥛" },
  { key: "molluscs", label: "Molluscs", emoji: "🦪" },
  { key: "mustard", label: "Mustard", emoji: "🟡" },
  { key: "peanuts", label: "Peanuts", emoji: "🥜" },
  { key: "sesame", label: "Sesame", emoji: "⚪" },
  { key: "soya", label: "Soya", emoji: "🫘" },
  { key: "sulphites", label: "Sulphur dioxide / sulphites", emoji: "🍷" },
  { key: "tree_nuts", label: "Tree nuts", emoji: "🌰" },
] as const;

export type AllergenKey = (typeof ALLERGENS)[number]["key"];

const byKey = new Map(ALLERGENS.map((a) => [a.key, a]));

export function allergenLabel(key: string): string {
  return byKey.get(key as AllergenKey)?.label ?? key;
}

export function allergenEmoji(key: string): string {
  return byKey.get(key as AllergenKey)?.emoji ?? "•";
}

// What the allergen screen is allowed to say. Staff read this to a customer
// with an allergy, so it must never turn "nobody has filled this in" into
// "safe". There is no confirmed-by field on a product yet, so a product
// counts as not checked when nothing at all is recorded for it, or when its
// note still carries the "confirm the allergens" flag the seeded sandwiches
// were created with.

export type AllergenFacts = { allergens: string[]; may_contain: string[]; notes: string | null };

const CONFIRM_FLAG = /confirm the allergens/i;

export function allergensNotChecked(product: AllergenFacts): boolean {
  if (product.allergens.length === 0 && product.may_contain.length === 0) return true;
  return CONFIRM_FLAG.test(product.notes ?? "");
}

export type AllergySplit<T> = {
  /** Lists the allergen as contains or may contain. */
  unsafe: T[];
  /** Doesn't list it, but the product's allergens haven't been checked. */
  notChecked: T[];
  /** Checked, and the allergen isn't in the recipe as recorded. */
  notRecorded: T[];
};

export function splitForAllergy<T extends AllergenFacts>(products: readonly T[], allergenKey: string): AllergySplit<T> {
  const split: AllergySplit<T> = { unsafe: [], notChecked: [], notRecorded: [] };
  for (const product of products) {
    if (product.allergens.includes(allergenKey) || product.may_contain.includes(allergenKey)) split.unsafe.push(product);
    else if (allergensNotChecked(product)) split.notChecked.push(product);
    else split.notRecorded.push(product);
  }
  return split;
}

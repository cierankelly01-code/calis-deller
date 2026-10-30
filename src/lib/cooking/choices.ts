// The hot food check offers only what this shop actually cooks: sausage
// rolls and pasties always, then anything else cooked here in the last two
// months (most often first). The full product list is one tap away under
// "Something else". Pure, so it's tested without a browser.

export type CookChoice = { id: string | null; name: string };

const ALWAYS: { name: string; match: RegExp }[] = [
  { name: "Sausage rolls", match: /sausage\s*roll/i },
  { name: "Pasties", match: /past(y|ies)/i },
];

const key = (name: string) => name.trim().toLowerCase();

export function cookedChoices(
  products: { id: string; name: string }[],
  recent: { product_id: string | null; product_name: string }[],
  limit = 8
): CookChoice[] {
  const choices: CookChoice[] = [];
  const seen = new Set<string>();
  const add = (choice: CookChoice) => {
    const k = key(choice.name);
    if (!k || seen.has(k) || choices.length >= limit) return;
    seen.add(k);
    choices.push(choice);
  };
  for (const item of ALWAYS) {
    const product = products.find((p) => item.match.test(p.name));
    add(product ? { id: product.id, name: product.name } : { id: null, name: item.name });
    // A product with another name for the same thing ("Sausage Roll") counts as seen.
    seen.add(key(item.name));
  }
  const counts = new Map<string, { choice: CookChoice; n: number }>();
  for (const r of recent) {
    if (ALWAYS.some((a) => a.match.test(r.product_name))) continue;
    const k = key(r.product_name);
    const entry = counts.get(k) ?? { choice: { id: r.product_id, name: r.product_name.trim() }, n: 0 };
    entry.n += 1;
    counts.set(k, entry);
  }
  for (const { choice } of [...counts.values()].sort((a, b) => b.n - a.n)) add(choice);
  return choices;
}

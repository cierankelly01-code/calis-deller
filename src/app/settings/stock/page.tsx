"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { fetchActiveProducts, fetchStockLines, type ActiveProduct, type StockLine } from "@/lib/data/queries";
import { parseAmount } from "@/lib/stock/lines";
import { formatMoney } from "@/lib/stock/ledger";
import { supabase } from "@/lib/supabase/client";
import type { StockUnit } from "@/types/database";

// Which products the close count covers, how each is counted (by the item or
// on the scale) and what it costs and sells for. Products come from the
// Allergen Guide, so there is one product list; prices live here, apart from
// the allergens, so they can be made manager-only later. Same prices in both
// shops. Config edits go straight to the server, like the allergen editor.

type Editor = { productId: string; line: StockLine | null; unit: StockUnit; cost: string; sell: string };

const moneyText = (n: number | null) => (n == null ? "" : n.toFixed(2));

export default function StockSettingsPage() {
  const { data: products, loading } = useCachedQuery("cd-products", fetchActiveProducts);
  const { data: cachedLines } = useCachedQuery("cd-stock-lines", fetchStockLines);
  const [freshLines, setFreshLines] = useState<StockLine[] | null>(null);
  const lines = useMemo(() => freshLines ?? cachedLines ?? [], [freshLines, cachedLines]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const lineFor = (productId: string) => lines.find((l) => l.product_id === productId) ?? null;
  const groups = useMemo(() => {
    const list = products ?? [];
    return [
      { title: "Counter / deli", items: list.filter((p) => p.category === "deli") },
      { title: "Sandwiches", items: list.filter((p) => p.category === "sandwich") },
    ].filter((g) => g.items.length > 0);
  }, [products]);
  const trackedCount = (products ?? []).filter((p) => lineFor(p.id)?.active).length;

  function open(product: ActiveProduct) {
    const line = lineFor(product.id);
    setSaveError(null);
    if (editor?.productId === product.id) return setEditor(null);
    setEditor({
      productId: product.id,
      line,
      unit: line?.unit ?? (product.category === "sandwich" ? "each" : "kg"),
      cost: moneyText(line?.cost_price ?? null),
      sell: moneyText(line?.sell_price ?? null),
    });
  }

  async function save(active: boolean) {
    if (!editor || saving) return;
    const cost = editor.cost.trim() === "" ? null : parseAmount(editor.cost);
    const sell = editor.sell.trim() === "" ? null : parseAmount(editor.sell);
    if ((editor.cost.trim() && cost == null) || (editor.sell.trim() && sell == null)) {
      setSaveError("Prices need to be numbers, like 2.20");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = { unit: editor.unit, cost_price: cost, sell_price: sell, active, updated_at: new Date().toISOString() };
      const { error } = editor.line
        ? await supabase.from("stock_lines").update(payload).eq("id", editor.line.id)
        : await supabase.from("stock_lines").insert({ ...payload, product_id: editor.productId });
      if (error) throw error;
      const fresh = await fetchStockLines();
      setFreshLines(fresh);
      window.localStorage.setItem("cd-stock-lines", JSON.stringify(fresh));
      setEditor(null);
    } catch (err) {
      setSaveError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Couldn't save — check the internet connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const perUnit = editor?.unit === "kg" ? "per kg" : "each";
  const cost = editor ? parseAmount(editor.cost) : null;
  const sell = editor ? parseAmount(editor.sell) : null;

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Stock list & prices" backHref="/settings" />
      <div className="flex-1 px-4 py-5 space-y-6 max-w-2xl w-full mx-auto">
        <p className="text-sm text-ink-soft">
          Tap a product to track it on the close count. Start with the fresh lines and the big earners — not every packet of crisps.
          Products are added in the <Link href="/allergens" className="text-brand font-semibold underline">Allergen Guide</Link>. Prices are the same in both shops.
        </p>
        <p className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider">{trackedCount} tracked</p>

        {loading && !products && <p className="text-ink-faint">Loading…</p>}
        {!loading && (products ?? []).length === 0 && (
          <p className="text-ink-soft rounded-2xl bg-surface border border-line p-4">
            No products yet — add them in the <Link href="/allergens" className="text-brand font-semibold underline">Allergen Guide</Link> first.
          </p>
        )}

        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">{group.title}</h2>
            <div className="space-y-2">
              {group.items.map((product) => {
                const line = lineFor(product.id);
                const tracked = !!line?.active;
                const editing = editor?.productId === product.id;
                return (
                  <div key={product.id} className={`rounded-2xl border ${tracked ? "bg-surface border-brand/30" : "bg-surface border-line"}`}>
                    <button type="button" onClick={() => open(product)} className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left">
                      <span>
                        <span className="block font-semibold text-ink">{product.name}</span>
                        <span className="block text-sm text-ink-soft">
                          {tracked
                            ? `${line!.unit === "kg" ? "By the kg" : "By the item"} · cost ${line!.cost_price == null ? "not set" : formatMoney(line!.cost_price)} · sells ${line!.sell_price == null ? "not set" : formatMoney(line!.sell_price)}`
                            : "Not tracked"}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${tracked ? "bg-brand-soft text-brand-deep" : "bg-paper text-ink-soft border border-line"}`}>
                        {tracked ? "✓ Tracked" : "Track"}
                      </span>
                    </button>

                    {editing && editor && (
                      <div className="border-t border-line px-4 py-4 space-y-4">
                        <div>
                          <p className="text-sm font-semibold text-ink mb-2">How do you count it?</p>
                          <div className="grid grid-cols-2 gap-2">
                            {([["each", "By the item", "pies, sandwiches, tubs"], ["kg", "On the scale (kg)", "loose ham, turkey, salads"]] as const).map(([unit, label, sub]) => (
                              <button
                                key={unit}
                                type="button"
                                onClick={() => setEditor({ ...editor, unit })}
                                aria-pressed={editor.unit === unit}
                                className={`min-h-14 rounded-2xl px-3 py-2 text-left text-sm font-semibold transition-all active:scale-95 ${
                                  editor.unit === unit ? "bg-ink text-paper shadow-sm" : "bg-paper text-ink border border-line"
                                }`}
                              >
                                {label}
                                <span className={`block text-xs font-normal ${editor.unit === unit ? "text-paper/70" : "text-ink-soft"}`}>{sub}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {([["cost", "It costs me"], ["sell", "I sell it for"]] as const).map(([field, label]) => (
                            <label key={field} className="block">
                              <span className="block text-sm font-semibold text-ink mb-1.5">{label} <span className="font-normal text-ink-soft">({perUnit})</span></span>
                              <span className="flex items-center h-12 rounded-2xl border border-line bg-paper px-3 focus-within:border-brand">
                                <span className="text-ink-soft mr-1">£</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={editor[field]}
                                  onChange={(e) => setEditor({ ...editor, [field]: e.target.value })}
                                  placeholder="0.00"
                                  className="w-full bg-transparent text-base focus:outline-none tabular-nums"
                                />
                              </span>
                            </label>
                          ))}
                        </div>
                        {cost != null && sell != null && sell > 0 && (
                          <p className={`text-sm font-semibold ${sell > cost ? "text-brand" : "text-danger"}`}>
                            Makes {formatMoney(sell - cost)} {perUnit} · {Math.round(((sell - cost) / sell) * 100)}% margin
                          </p>
                        )}
                        <p className="text-xs text-ink-soft">No price yet? Leave it blank — it still gets counted, and the weekly summary says which lines need a price.</p>
                        {saveError && <p className="text-danger font-medium" role="alert">{saveError}</p>}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => save(true)}
                            className="flex-1 h-12 rounded-2xl bg-brand text-white font-semibold shadow-sm active:bg-brand-deep disabled:opacity-40"
                          >
                            {saving ? "Saving…" : tracked ? "Save" : "Track this"}
                          </button>
                          {tracked && (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => save(false)}
                              className="h-12 rounded-2xl bg-surface border border-danger/40 px-4 text-danger font-semibold"
                            >
                              Stop tracking
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

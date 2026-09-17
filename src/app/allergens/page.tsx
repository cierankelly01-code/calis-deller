"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveProducts, type ActiveProduct } from "@/lib/data/queries";
import { ALLERGENS, allergenEmoji, allergenLabel } from "@/lib/allergens";
import { supabase } from "@/lib/supabase/client";
import { useUser } from '@/components/auth/AuthBoundary';

// The screen staff open mid-service when a customer asks "does this contain
// nuts?" — search must be instant and the answer unmissable. Tapping an
// allergen chip flips to "safe for this allergy" mode: what CAN they eat.
// Product editing lives on the same screen (mode switch) so there's one
// place to look.

type EditorState = {
  id: string | null; // null = adding a new product
  name: string;
  allergens: string[];
  mayContain: string[];
  notes: string;
  openLifeDays: number; // sell within N days once opened for the counter
};

const LIFE_OPTIONS = [1, 2, 3, 4, 5, 7];

function AllergenChips({ keys, tone }: { keys: string[]; tone: "contains" | "may" }) {
  if (keys.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((key) => (
        <span
          key={key}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium ${
            tone === "contains" ? "bg-danger-soft text-danger-deep" : "bg-gold-soft text-gold-deep"
          }`}
        >
          {allergenEmoji(key)} {tone === "may" ? `may: ${allergenLabel(key)}` : allergenLabel(key)}
        </span>
      ))}
    </div>
  );
}

function ProductCard({ product, onEdit }: { product: ActiveProduct; onEdit: () => void }) {
  const canEdit = useUser()?.role === 'manager';
  return (
    <div className="rounded-2xl bg-surface border border-line shadow-sm p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-lg font-bold text-ink">{product.name}</p>
        {canEdit && <button type="button" onClick={onEdit} className="text-sm font-semibold text-brand shrink-0">
          Edit
        </button>}
      </div>
      {product.allergens.length === 0 && product.may_contain.length === 0 ? (
        <p className="text-brand font-medium">✓ No declared allergens</p>
      ) : (
        <>
          <AllergenChips keys={product.allergens} tone="contains" />
          <AllergenChips keys={product.may_contain} tone="may" />
        </>
      )}
      {product.notes && <p className="text-sm text-ink-soft">{product.notes}</p>}
      <p className="text-xs text-ink-faint">Once open: sell within {product.open_life_days} day{product.open_life_days === 1 ? "" : "s"}</p>
    </div>
  );
}

export default function AllergensPage() {
  const canEdit = useUser()?.role === 'manager';
  const { site } = useSite();
  const { data: products, loading } = useCachedQuery(`cd-products:${site.id}`, () => fetchActiveProducts(site.id));
  const [search, setSearch] = useState("");
  const [filterKey, setFilterKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Config edits go straight to Supabase (they need to be authoritative, not
  // queued); after a save we refetch and overwrite the local cache.
  const [localProducts, setLocalProducts] = useState<ActiveProduct[] | null>(null);

  const list = useMemo(() => localProducts ?? products ?? [], [localProducts, products]);
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => p.name.toLowerCase().includes(q));
  }, [list, search]);

  const split = useMemo(() => {
    if (!filterKey) return null;
    const unsafe = searched.filter(
      (p) => p.allergens.includes(filterKey) || p.may_contain.includes(filterKey)
    );
    const safe = searched.filter((p) => !unsafe.includes(p));
    return { safe, unsafe };
  }, [searched, filterKey]);

  function startAdd() {
    if (!canEdit) return;
    setSaveError(null);
    setEditor({ id: null, name: search.trim(), allergens: [], mayContain: [], notes: "", openLifeDays: 3 });
  }

  function startEdit(product: ActiveProduct) {
    if (!canEdit) return;
    setSaveError(null);
    setEditor({
      id: product.id,
      name: product.name,
      allergens: product.allergens,
      mayContain: product.may_contain,
      notes: product.notes ?? "",
      openLifeDays: product.open_life_days,
    });
  }

  function toggleAllergen(key: string) {
    if (!editor) return;
    // Cycle: none -> contains -> may contain -> none. One tap-target per
    // allergen keeps the grid usable on a 14-item list.
    if (editor.allergens.includes(key)) {
      setEditor({
        ...editor,
        allergens: editor.allergens.filter((k) => k !== key),
        mayContain: [...editor.mayContain, key],
      });
    } else if (editor.mayContain.includes(key)) {
      setEditor({ ...editor, mayContain: editor.mayContain.filter((k) => k !== key) });
    } else {
      setEditor({ ...editor, allergens: [...editor.allergens, key] });
    }
  }

  async function saveProduct(deactivate = false) {
    if (!editor || !canEdit) return;
    setSavingProduct(true);
    setSaveError(null);
    try {
      const payload = {
        site_id: site.id,
        name: editor.name.trim(),
        allergens: editor.allergens,
        may_contain: editor.mayContain,
        notes: editor.notes.trim() || null,
        open_life_days: editor.openLifeDays,
        active: !deactivate,
        updated_at: new Date().toISOString(),
      };
      const query = editor.id
        ? supabase.from("products").update(payload).eq("id", editor.id)
        : supabase.from("products").insert(payload);
      const { error } = await query;
      if (error) throw error;

      const fresh = await fetchActiveProducts(site.id);
      setLocalProducts(fresh);
      window.localStorage.setItem(`cd-products:${site.id}`, JSON.stringify(fresh));
      setEditor(null);
    } catch (err) {
      setSaveError(
        err instanceof Error && err.message !== "Failed to fetch"
          ? err.message
          : "Couldn't save — check the internet connection and try again."
      );
    } finally {
      setSavingProduct(false);
    }
  }

  if (editor) {
    const canSaveProduct = editor.name.trim().length > 0 && !savingProduct;
    return (
      <div className="flex flex-col flex-1">
        <PageHeader title={editor.id ? "Edit Product" : "Add Product"} backHref="/allergens" />
        <div className="flex-1 px-4 py-5 space-y-6 max-w-2xl w-full mx-auto">
          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2">
              Product name
            </h2>
            <input
              type="text"
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              placeholder="e.g. Steak Bake"
              className="w-full h-12 rounded-2xl border border-line bg-surface px-4 text-base placeholder:text-ink-faint focus:outline-none focus:border-brand"
              autoFocus={!editor.id}
            />
          </section>

          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-1">
              Allergens
            </h2>
            <p className="text-sm text-ink-soft mb-3">
              Tap once = <span className="text-danger font-semibold">contains</span>, tap twice ={" "}
              <span className="text-gold-deep font-semibold">may contain</span>, tap again to clear.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {ALLERGENS.map((a) => {
                const state = editor.allergens.includes(a.key)
                  ? "contains"
                  : editor.mayContain.includes(a.key)
                    ? "may"
                    : "none";
                return (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => toggleAllergen(a.key)}
                    className={`min-h-14 rounded-2xl px-3 py-2 text-left text-sm font-semibold transition-all active:scale-95 ${
                      state === "contains"
                        ? "bg-danger text-white shadow-sm"
                        : state === "may"
                          ? "bg-gold text-ink shadow-sm"
                          : "bg-surface text-ink border border-line shadow-sm"
                    }`}
                  >
                    {a.emoji} {a.label}
                    {state === "may" && <span className="block text-xs font-normal">may contain</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-1">
              Once opened for the counter, sell within
            </h2>
            <p className="text-sm text-ink-soft mb-3">
              Days including the day it goes out. The pack&apos;s own use-by still wins if it&apos;s sooner.
            </p>
            <div className="grid grid-cols-6 gap-2">
              {LIFE_OPTIONS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setEditor({ ...editor, openLifeDays: days })}
                  className={`h-12 rounded-2xl text-base font-semibold transition-all active:scale-95 ${
                    days === editor.openLifeDays
                      ? "bg-ink text-paper shadow-sm"
                      : "bg-surface text-ink border border-line shadow-sm"
                  }`}
                >
                  {days}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2">
              Notes (optional)
            </h2>
            <textarea
              value={editor.notes}
              onChange={(e) => setEditor({ ...editor, notes: e.target.value })}
              placeholder="e.g. pastry contains wheat flour; fried in same oil as fish"
              className="w-full rounded-2xl border border-line bg-surface p-3.5 text-base min-h-20 placeholder:text-ink-faint focus:outline-none focus:border-brand"
            />
          </section>

          {saveError && <p className="text-danger font-medium">{saveError}</p>}

          <button
            type="button"
            disabled={!canSaveProduct}
            onClick={() => saveProduct()}
            className="w-full h-14 rounded-2xl bg-brand text-white text-lg font-semibold shadow-sm active:bg-brand-deep disabled:opacity-40"
          >
            {savingProduct ? "Saving…" : "Save product"}
          </button>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setEditor(null)}
              className="flex-1 h-12 rounded-2xl bg-surface border border-line text-ink-soft font-semibold"
            >
              Cancel
            </button>
            {editor.id && (
              <button
                type="button"
                disabled={savingProduct}
                onClick={() => saveProduct(true)}
                className="flex-1 h-12 rounded-2xl bg-surface border border-danger/40 text-danger font-semibold"
              >
                Remove product
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Allergen Guide" />
      <div className="flex-1 px-4 py-5 space-y-4 max-w-2xl w-full mx-auto">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍  Search a product…"
          aria-label="Search products"
          className="w-full h-14 rounded-2xl border border-line bg-surface px-4 text-lg placeholder:text-ink-faint focus:outline-none focus:border-brand"
        />

        <div>
          <p className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2">
            Customer has an allergy? Tap it
          </p>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
            {ALLERGENS.map((a) => {
              const active = filterKey === a.key;
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setFilterKey(active ? null : a.key)}
                  className={`shrink-0 h-11 rounded-full px-4 text-sm font-semibold transition-all active:scale-95 ${
                    active
                      ? "bg-ink text-paper shadow-sm"
                      : "bg-surface text-ink border border-line"
                  }`}
                >
                  {a.emoji} {a.label}
                </button>
              );
            })}
          </div>
        </div>

        {loading && list.length === 0 && <p className="text-ink-faint">Loading…</p>}

        {!loading && searched.length === 0 && (
          <p className="text-ink-soft text-center py-8" role="status">
            {search ? `Nothing matching “${search}”.` : "No products yet — add the first one below."}
          </p>
        )}

        {split ? (
          <>
            <section>
              <h2 className="text-[13px] font-semibold text-brand uppercase tracking-wider mb-2">
                ✓ Safe — no {allergenLabel(filterKey!).toLowerCase()}
              </h2>
              {split.safe.length === 0 ? (
                <p className="text-sm text-ink-soft rounded-2xl bg-surface border border-line p-4">
                  Nothing on the list is safe for this allergy.
                </p>
              ) : (
                <div className="space-y-3">
                  {split.safe.map((p) => (
                    <ProductCard key={p.id} product={p} onEdit={() => startEdit(p)} />
                  ))}
                </div>
              )}
            </section>
            <section>
              <h2 className="text-[13px] font-semibold text-danger uppercase tracking-wider mb-2">
                ✗ Not safe — contains or may contain
              </h2>
              <div className="space-y-3">
                {split.unsafe.map((p) => (
                  <ProductCard key={p.id} product={p} onEdit={() => startEdit(p)} />
                ))}
              </div>
            </section>
          </>
        ) : (
          <div className="space-y-3">
            {searched.map((p) => (
              <ProductCard key={p.id} product={p} onEdit={() => startEdit(p)} />
            ))}
          </div>
        )}

        {canEdit && <button
          type="button"
          onClick={startAdd}
          className="w-full h-14 rounded-2xl bg-brand text-white text-lg font-semibold shadow-sm active:bg-brand-deep"
        >
          + Add a product
        </button>}

        <p className="text-xs text-ink-faint text-center pb-4">
          Contains = recipe ingredient · May contain = cross-contamination risk
        </p>
      </div>
    </div>
  );
}

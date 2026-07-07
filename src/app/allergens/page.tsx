"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { fetchActiveProducts, type ActiveProduct } from "@/lib/data/queries";
import { ALLERGENS, allergenEmoji, allergenLabel } from "@/lib/allergens";
import { supabase } from "@/lib/supabase/client";

// The screen staff open mid-service when a customer asks "does this contain
// nuts?" — search must be instant and the answer unmissable. Product editing
// lives on the same screen (mode switch) so there's one place to look.

type EditorState = {
  id: string | null; // null = adding a new product
  name: string;
  allergens: string[];
  mayContain: string[];
  notes: string;
};

function AllergenChips({ keys, tone }: { keys: string[]; tone: "contains" | "may" }) {
  if (keys.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((key) => (
        <span
          key={key}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium ${
            tone === "contains" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {allergenEmoji(key)} {allergenLabel(key)}
        </span>
      ))}
    </div>
  );
}

export default function AllergensPage() {
  const { data: products, loading } = useCachedQuery("cd-products", fetchActiveProducts);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Config edits go straight to Supabase (they need to be authoritative, not
  // queued) — refreshKey forces a refetch through the cache after a save.
  const [localProducts, setLocalProducts] = useState<ActiveProduct[] | null>(null);

  const list = useMemo(() => localProducts ?? products ?? [], [localProducts, products]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => p.name.toLowerCase().includes(q));
  }, [list, search]);

  function startAdd() {
    setSaveError(null);
    setEditor({ id: null, name: search.trim(), allergens: [], mayContain: [], notes: "" });
  }

  function startEdit(product: ActiveProduct) {
    setSaveError(null);
    setEditor({
      id: product.id,
      name: product.name,
      allergens: product.allergens,
      mayContain: product.may_contain,
      notes: product.notes ?? "",
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
    if (!editor) return;
    setSavingProduct(true);
    setSaveError(null);
    try {
      const payload = {
        name: editor.name.trim(),
        allergens: editor.allergens,
        may_contain: editor.mayContain,
        notes: editor.notes.trim() || null,
        active: !deactivate,
        updated_at: new Date().toISOString(),
      };
      const query = editor.id
        ? supabase.from("products").update(payload).eq("id", editor.id)
        : supabase.from("products").insert(payload);
      const { error } = await query;
      if (error) throw error;

      const fresh = await fetchActiveProducts();
      setLocalProducts(fresh);
      window.localStorage.setItem("cd-products", JSON.stringify(fresh));
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
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-2xl w-full mx-auto">
          <section>
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-2">
              Product name
            </h2>
            <input
              type="text"
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              placeholder="e.g. Steak Bake"
              className="w-full h-12 rounded-xl border border-zinc-300 px-3 text-base"
              autoFocus={!editor.id}
            />
          </section>

          <section>
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-1">
              Allergens
            </h2>
            <p className="text-sm text-zinc-500 mb-3">
              Tap once = <span className="text-red-700 font-semibold">contains</span>, tap twice ={" "}
              <span className="text-amber-700 font-semibold">may contain</span>, tap again to clear.
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
                    className={`h-14 rounded-xl px-3 text-left text-sm font-semibold transition-colors active:scale-95 ${
                      state === "contains"
                        ? "bg-red-600 text-white"
                        : state === "may"
                          ? "bg-amber-500 text-white"
                          : "bg-white text-zinc-900 border border-zinc-200 shadow-sm"
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
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-2">
              Notes (optional)
            </h2>
            <textarea
              value={editor.notes}
              onChange={(e) => setEditor({ ...editor, notes: e.target.value })}
              placeholder="e.g. pastry contains wheat flour; fried in same oil as fish"
              className="w-full rounded-xl border border-zinc-300 p-3 text-base min-h-20"
            />
          </section>

          {saveError && <p className="text-red-600 font-medium">{saveError}</p>}

          <button
            type="button"
            disabled={!canSaveProduct}
            onClick={() => saveProduct()}
            className="w-full h-14 rounded-xl bg-teal-700 text-white text-lg font-semibold disabled:opacity-40"
          >
            {savingProduct ? "Saving…" : "Save product"}
          </button>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setEditor(null)}
              className="flex-1 h-12 rounded-xl bg-white border border-zinc-300 text-zinc-700 font-semibold"
            >
              Cancel
            </button>
            {editor.id && (
              <button
                type="button"
                disabled={savingProduct}
                onClick={() => saveProduct(true)}
                className="flex-1 h-12 rounded-xl bg-white border border-red-300 text-red-700 font-semibold"
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
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 max-w-2xl w-full mx-auto">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍  Search a product…"
          className="w-full h-14 rounded-xl border border-zinc-300 px-4 text-lg"
          autoFocus
        />

        {loading && list.length === 0 && <p className="text-zinc-400">Loading…</p>}

        {!loading && filtered.length === 0 && (
          <p className="text-zinc-500 text-center py-8">
            {search ? `Nothing matching “${search}”.` : "No products yet — add the first one below."}
          </p>
        )}

        <div className="space-y-3">
          {filtered.map((product) => (
            <div key={product.id} className="rounded-xl bg-white border border-zinc-200 p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-lg font-bold text-zinc-900">{product.name}</p>
                <button
                  type="button"
                  onClick={() => startEdit(product)}
                  className="text-sm font-semibold text-teal-700 shrink-0"
                >
                  Edit
                </button>
              </div>
              {product.allergens.length === 0 && product.may_contain.length === 0 ? (
                <p className="text-teal-700 font-medium">✓ No declared allergens</p>
              ) : (
                <>
                  <AllergenChips keys={product.allergens} tone="contains" />
                  <AllergenChips keys={product.may_contain} tone="may" />
                </>
              )}
              {product.notes && <p className="text-sm text-zinc-500">{product.notes}</p>}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={startAdd}
          className="w-full h-14 rounded-xl bg-teal-700 text-white text-lg font-semibold"
        >
          + Add a product
        </button>

        <p className="text-xs text-zinc-400 text-center pb-4">
          Contains = recipe ingredient · May contain = cross-contamination risk
        </p>
      </div>
    </div>
  );
}

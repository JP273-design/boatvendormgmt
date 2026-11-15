"use client";

import { useState, useTransition } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { aiDraftChecklist, saveTemplate } from "@/app/actions";
import type { ChecklistItem } from "@/db/schema";

/** Describe a product → Claude drafts a checklist → procurement edits and approves it. */
export function TemplateEditor() {
  const [category, setCategory] = useState<"speaker" | "soundbar">("speaker");
  const [product, setProduct] = useState("");
  const [notes, setNotes] = useState("");
  const [name, setName] = useState("");
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  const draft = () =>
    start(async () => {
      setMsg(null);
      const res = await aiDraftChecklist(category, product, notes);
      if (res.error || !res.items) return setMsg({ error: res.error ?? "No checklist returned" });
      setName(res.name ?? `${product} - pre-shipment inspection`);
      setItems(res.items);
    });

  const save = (approved: boolean) =>
    start(async () => {
      if (!items) return;
      const res = await saveTemplate({ category, name, items, approved, aiDrafted: true });
      setMsg(res);
      if (res?.ok) {
        setItems(null);
        setProduct("");
        setNotes("");
      }
    });

  const patch = (id: string, p: Partial<ChecklistItem>) => setItems((list) => list!.map((i) => (i.id === id ? { ...i, ...p } : i)));

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div>
          <label className="label" htmlFor="cat">Category</label>
          <select id="cat" value={category} onChange={(e) => setCategory(e.target.value as "speaker" | "soundbar")} className="input w-auto">
            <option value="speaker">Portable speaker</option>
            <option value="soundbar">Soundbar</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="product">Product</label>
          <input id="product" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. Stone 1500 party speaker, 100 W, RGB lights, IPX5" className="input" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="notes">Anything specific to check (optional)</label>
          <input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. new battery supplier this batch; mic input added" className="input" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={draft} disabled={pending || !product.trim()} className="btn btn-dark">
          <Sparkles className="h-4 w-4" /> {pending && !items ? "Claude is drafting…" : items ? "Redraft" : "Draft checklist with AI"}
        </button>
        {msg?.error && <span role="alert" className="text-xs font-medium text-red-600">{msg.error}</span>}
        {msg?.ok && <span className="text-xs font-medium text-emerald-700">{msg.ok}</span>}
        <span className="text-xs text-muted">Claude also sees defects found on past inspections in this category.</span>
      </div>

      {items && (
        <div className="mt-5 border-t border-line pt-4">
          <label className="label" htmlFor="tname">Checklist name</label>
          <input id="tname" value={name} onChange={(e) => setName(e.target.value)} className="input mb-3 font-medium" />
          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.id} className="grid gap-2 rounded-lg border border-line p-2.5 xl:grid-cols-[150px_1fr_180px_auto_auto] xl:items-center">
                <input value={it.section} onChange={(e) => patch(it.id, { section: e.target.value })} className="input py-1.5 text-xs" aria-label="Section" />
                <input value={it.check} onChange={(e) => patch(it.id, { check: e.target.value })} className="input py-1.5 text-sm" aria-label="Check" />
                <input value={it.method} onChange={(e) => patch(it.id, { method: e.target.value })} className="input py-1.5 text-xs" aria-label="Method" />
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={it.critical} onChange={(e) => patch(it.id, { critical: e.target.checked })} /> Critical
                </label>
                <button type="button" onClick={() => setItems(items.filter((x) => x.id !== it.id))} aria-label="Remove check" className="justify-self-start rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setItems([...items, { id: `n${Date.now()}`, section: items.at(-1)?.section ?? "General", check: "", method: "", critical: false }])}>
              <Plus className="h-3.5 w-3.5" /> Add check
            </button>
            <span className="flex-1" />
            <button type="button" className="btn" disabled={pending} onClick={() => save(false)}>Save as draft</button>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => save(true)}>Approve and use for {category}s</button>
          </div>
        </div>
      )}
    </div>
  );
}

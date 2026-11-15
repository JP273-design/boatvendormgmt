"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Camera, Check, Minus, X } from "lucide-react";
import { submitInspection } from "@/app/actions";
import type { ChecklistItem, ChecklistResult } from "@/db/schema";
import { inspectionVerdict } from "@/lib/rules";

/** Shrink a phone photo to a small JPEG so it can travel with the checklist. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

const CHOICES = [
  { value: "pass", label: "Pass", icon: Check, on: "border-emerald-600 bg-emerald-600 text-white" },
  { value: "fail", label: "Fail", icon: X, on: "border-red-600 bg-red-600 text-white" },
  { value: "na", label: "N/A", icon: Minus, on: "border-slate-500 bg-slate-500 text-white" },
] as const;

/**
 * The factory-floor checklist. Built for a phone: big tap targets, one check
 * per card, live verdict at the bottom. Read-only once signed off.
 */
export function InspectionForm({ inspectionId, items, initial, editable, poId }: { inspectionId: string; items: ChecklistItem[]; initial: ChecklistResult[]; editable: boolean; poId: string }) {
  const router = useRouter();
  const [results, setResults] = useState<Record<string, ChecklistResult>>(() => Object.fromEntries(initial.map((r) => [r.itemId, r])));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const list = useMemo(() => Object.values(results), [results]);
  const verdict = inspectionVerdict(items, list);
  const sections = useMemo(() => [...new Set(items.map((i) => i.section))], [items]);
  const set = (itemId: string, patch: Partial<ChecklistResult>) =>
    setResults((r) => ({ ...r, [itemId]: { ...(r[itemId] ?? { itemId, result: "pass" }), ...patch } as ChecklistResult }));

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await submitInspection(inspectionId, list, notes);
      if (res?.error) setError(res.error);
      else router.push(`/pos/${res?.poId ?? poId}`);
    });

  return (
    <div className="space-y-5 pb-28">
      {sections.map((section) => (
        <section key={section}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{section}</h2>
          <div className="space-y-2">
            {items.filter((i) => i.section === section).map((item) => {
              const r = results[item.id];
              return (
                <div key={item.id} className={clsx("rounded-xl border bg-white p-3.5", r?.result === "fail" ? "border-red-300" : "border-line")}>
                  <div className="text-sm font-medium">
                    {item.check}
                    {item.critical && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 ring-1 ring-inset ring-red-200">Critical</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{item.method}</div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {CHOICES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        disabled={!editable}
                        onClick={() => set(item.id, { result: c.value })}
                        className={clsx("flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm font-medium transition", r?.result === c.value ? c.on : "border-line bg-white text-slate-600", editable && r?.result !== c.value && "hover:border-slate-400", !editable && r?.result !== c.value && "opacity-40")}
                      >
                        <c.icon className="h-4 w-4" /> {c.label}
                      </button>
                    ))}
                  </div>

                  {(r?.result === "fail" || r?.note || r?.photoUrl) && (
                    <div className="mt-3 space-y-2">
                      {editable ? (
                        <textarea value={r?.note ?? ""} onChange={(e) => set(item.id, { note: e.target.value })} rows={2} placeholder="What did you find ? e.g. 4 of 200 units fail to pair within 5 s" className="input" />
                      ) : (
                        r?.note && <p className="text-sm text-slate-700">{r.note}</p>
                      )}
                      {r?.photoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.photoUrl} alt="Defect photo" className="max-h-48 rounded-lg border border-line" />
                      )}
                      {editable && (
                        <label className="btn btn-sm cursor-pointer">
                          <Camera className="h-3.5 w-3.5" /> {r?.photoUrl ? "Replace photo" : "Add photo"}
                          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) set(item.id, { photoUrl: await shrink(f) }); }} />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {editable && (
        <>
          <div>
            <label className="label" htmlFor="notes">Overall remarks (optional)</label>
            <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input" />
          </div>
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-4 py-3 backdrop-blur lg:left-60">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1 text-sm">
                {!verdict.complete ? (
                  <span className="text-muted">{items.length - verdict.unanswered.length} of {items.length} checks done</span>
                ) : verdict.passed ? (
                  <span className="font-semibold text-emerald-700">Result: PASS{verdict.minorFails.length ? ` with ${verdict.minorFails.length} minor observation${verdict.minorFails.length > 1 ? "s" : ""}` : ""}</span>
                ) : (
                  <span className="font-semibold text-red-600">Result: FAIL - {verdict.criticalFails.length} critical, {verdict.minorFails.length} minor</span>
                )}
                {error && <div role="alert" className="text-xs font-medium text-red-600">{error}</div>}
              </div>
              <button type="button" onClick={submit} disabled={pending || !verdict.complete} className="btn btn-primary">
                {pending ? "Submitting…" : "Sign off inspection"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

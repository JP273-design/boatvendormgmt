"use client";

import { FileUp } from "lucide-react";
import { uploadDocument } from "@/app/actions";
import { ActionForm } from "./action-form";

/** Upload a packing list, B/L or invoice. Claude reads it; the workflow engine matches it against the PO and lot. */
export function DocumentUpload({ poId, lots }: { poId: string; lots: { id: string; lotNumber: string }[] }) {
  return (
    <ActionForm action={uploadDocument} hidden={{ poId }} submit={<><FileUp className="h-3.5 w-3.5" /> Read and match</>} variant="dark" small>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required className="input py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs" />
        <select name="type" className="input w-auto py-1.5 text-xs" aria-label="Document type" defaultValue="auto">
          <option value="auto">Detect type</option>
          <option value="packing_list">Packing list</option>
          <option value="bill_of_lading">Bill of lading</option>
          <option value="invoice">Invoice</option>
        </select>
        <select name="lotId" className="input w-auto py-1.5 text-xs" aria-label="Lot" defaultValue={lots.at(-1)?.id ?? ""}>
          <option value="">Whole PO</option>
          {lots.map((l) => (
            <option key={l.id} value={l.id}>{l.lotNumber}</option>
          ))}
        </select>
      </div>
      {lots.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          No document handy ? Download a sample for {lots.at(-1)!.lotNumber}:{" "}
          {[["packing_list", "packing list"], ["bill_of_lading", "bill of lading"], ["invoice", "invoice"]].map(([t, label]) => (
            <a key={t} href={`/api/sample-doc?lot=${lots.at(-1)!.id}&type=${t}`} className="mr-2 underline decoration-slate-300 underline-offset-2 hover:text-ink">{label}</a>
          ))}
          <a href={`/api/sample-doc?lot=${lots.at(-1)!.id}&type=invoice&error=1`} className="underline decoration-slate-300 underline-offset-2 hover:text-ink">over-billed invoice</a>
        </p>
      )}
    </ActionForm>
  );
}

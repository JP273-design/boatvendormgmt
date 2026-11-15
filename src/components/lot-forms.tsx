import { ActionForm } from "@/components/action-form";
import type { Lot } from "@/db/schema";
import { advanceLot, receiveLot, shipLot, updateEta } from "@/app/actions";
import { DAY, isoDate, LOT_STAGE_LABEL, num } from "@/lib/format";

/** Lot-level forms shared by the PO page and the logistics / warehouse boards. */

export function LogisticsActions({ lot: l }: { lot: Lot }) {
  const hidden = { lotId: l.id };
  return (
    <div>
      <div className="mb-2 text-sm"><span className="font-mono font-medium">{l.lotNumber}</span> <span className="text-muted">· {l.containerNo} · {LOT_STAGE_LABEL[l.status]}</span></div>
      <div className="flex flex-wrap items-end gap-3">
        {l.status === "SHIPPED" && (
          <>
            <ActionForm action={advanceLot} hidden={{ ...hidden, to: "AT_PORT" }} submit="Mark arrived at port" small />
            <ActionForm action={updateEta} hidden={hidden} submit="Revise ETA" small variant="plain" className="flex items-end gap-2 [&>div]:mt-0">
              <input name="eta" type="date" defaultValue={l.eta ? isoDate(l.eta) : undefined} className="input w-auto py-1.5 text-xs" aria-label="New ETA" required />
            </ActionForm>
          </>
        )}
        {l.status === "AT_PORT" && <ActionForm action={advanceLot} hidden={{ ...hidden, to: "CUSTOMS_CLEARED" }} submit="Mark customs cleared" small />}
        {l.status === "CUSTOMS_CLEARED" && <ActionForm action={advanceLot} hidden={{ ...hidden, to: "PICKED_UP" }} submit="Mark picked up" small />}
      </div>
    </div>
  );
}

export function ReceiveForm({ lot: l }: { lot: Lot }) {
  return (
    <ActionForm action={receiveLot} hidden={{ lotId: l.id }} submit="Post GRN to SAP">
      <div className="mb-2 text-sm"><span className="font-mono font-medium">{l.lotNumber}</span> <span className="text-muted">· container {l.containerNo} · expected {num(l.qty)} units in {num(l.cartons)} cartons</span></div>
      <div className="grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_2fr]">
        <div><label className="label">Received OK</label><input name="receivedQty" type="number" min={0} max={l.qty} defaultValue={l.qty} className="input" required /></div>
        <div><label className="label">Damaged</label><input name="damagedQty" type="number" min={0} max={l.qty} defaultValue={0} className="input" /></div>
        <div className="col-span-2 sm:col-span-1"><label className="label">Note (required if short or damaged)</label><input name="note" className="input" placeholder="e.g. 3 cartons crushed" /></div>
      </div>
    </ActionForm>
  );
}

export function ShipForm({ lot: l, now }: { lot: Lot; now: Date }) {
  return (
    <ActionForm action={shipLot} hidden={{ lotId: l.id }} submit="Save shipping details">
      <p className="mb-3 text-sm text-slate-600">Lot <span className="font-mono font-medium">{l.lotNumber}</span> is created. Add the container and sailing details so boAt can plan port clearance.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><label className="label">Container number</label><input name="containerNo" className="input font-mono uppercase" placeholder="MSKU1234565" required /></div>
        <div><label className="label">Bill of lading no.</label><input name="blNo" className="input font-mono uppercase" required /></div>
        <div><label className="label">Carrier</label><select name="carrier" className="input">{["Maersk", "MSC", "COSCO", "ONE", "Evergreen", "CMA CGM"].map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label className="label">Vessel</label><input name="vessel" className="input" required /></div>
        <div><label className="label">Port of loading</label><select name="portOfLoading" className="input">{["Yantian", "Shekou", "Nansha"].map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label className="label">Port of discharge</label><select name="portOfDischarge" className="input">{["Nhava Sheva (JNPT)", "Mundra", "Chennai"].map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label className="label">ETD</label><input name="etd" type="date" defaultValue={isoDate(new Date(now.getTime() + 2 * DAY))} className="input" required /></div>
        <div><label className="label">ETA India</label><input name="eta" type="date" defaultValue={isoDate(new Date(now.getTime() + 21 * DAY))} className="input" required /></div>
      </div>
    </ActionForm>
  );
}

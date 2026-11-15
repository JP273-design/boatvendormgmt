import "server-only";
import { cache } from "react";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DocumentRow, GoodsReceipt, Lot, Payment, PurchaseOrder, QcInspection, Vendor } from "@/db/schema";
import { DAY, LOT_STAGE_LABEL, PO_STAGE_LABEL } from "./format";
import { isExec, type Persona, type Role } from "./personas";
import { scorePo, vendorStats, type Risk, type VendorStats } from "./risk";
import { laggingLot, milestoneIndex } from "./rules";

export type PoView = {
  po: PurchaseOrder;
  vendor: Vendor;
  lots: Lot[];
  inspections: QcInspection[];
  payments: Payment[];
  docs: DocumentRow[];
  grns: GoodsReceipt[];
  risk: Risk;
  milestone: number;
  stage: string;
  open: boolean;
};

export type Alert = {
  id: string;
  severity: "high" | "medium";
  kind: string;
  title: string;
  detail: string;
  poId: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  owners: Role[];
};

const FACTOR_OWNER: Record<string, Role[]> = {
  "QC not scheduled": ["procurement"],
  "Stuck at port": ["logistics"],
  "Pickup pending": ["logistics"],
  "Arrival overdue": ["logistics"],
  "ETA slipped": ["logistics", "procurement"],
  "GRN pending": ["warehouse"],
};

/** One read of the whole (small) dataset per request, with risk and alerts derived on top. */
export const getSnapshot = cache(async () => {
  const now = new Date();
  const [vendors, pos, lots, inspections, payments, docs, grns] = await Promise.all([
    db.select().from(schema.vendors).orderBy(asc(schema.vendors.name)),
    db.select().from(schema.purchaseOrders).orderBy(desc(schema.purchaseOrders.issuedAt)),
    db.select().from(schema.lots).orderBy(asc(schema.lots.lotNumber)),
    db.select().from(schema.qcInspections).orderBy(asc(schema.qcInspections.requestedAt)),
    db.select().from(schema.payments).orderBy(asc(schema.payments.dueDate)),
    db.select().from(schema.documents).orderBy(asc(schema.documents.createdAt)),
    db.select().from(schema.goodsReceipts),
  ]);

  const stats = new Map<string, VendorStats>(vendors.map((v) => [v.id, vendorStats(v.id, pos, inspections, docs, now)]));
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const group = <T extends { poId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(r.poId) ?? m.set(r.poId, []).get(r.poId)!).push(r);
    return m;
  };
  const gl = group(lots), gi = group(inspections), gp = group(payments), gd = group(docs), gg = group(grns);

  const views: PoView[] = pos.map((po) => {
    const pl = gl.get(po.id) ?? [];
    const pi = gi.get(po.id) ?? [];
    const lag = laggingLot(pl);
    const stage =
      po.status === "IN_TRANSIT" && lag
        ? pl.length > 1
          ? `${pl.filter((l) => l.status === "RECEIVED").length}/${pl.length} lots received`
          : LOT_STAGE_LABEL[lag]
        : PO_STAGE_LABEL[po.status];
    return {
      po,
      vendor: vendorById.get(po.vendorId)!,
      lots: pl,
      inspections: pi,
      payments: gp.get(po.id) ?? [],
      docs: gd.get(po.id) ?? [],
      grns: gg.get(po.id) ?? [],
      risk: scorePo(po, pl, pi, stats.get(po.vendorId), now),
      milestone: milestoneIndex(po.status, pl),
      stage,
      open: po.status !== "PAID" && po.status !== "CLOSED",
    };
  });

  const alerts: Alert[] = [];
  for (const v of views) {
    const base = { poId: v.po.id, poNumber: v.po.poNumber, vendorId: v.vendor.id, vendorName: v.vendor.name };
    const top = v.risk.factors[0];
    if (top && v.risk.level !== "low") {
      alerts.push({
        ...base, id: `risk-${v.po.id}`, severity: v.risk.level, kind: "Delay risk", title: top.label, detail: top.detail,
        owners: FACTOR_OWNER[top.label] ?? ["procurement", "vendor"],
      });
    }
    for (const doc of v.docs) {
      if (doc.matchStatus === "mismatch" && v.po.status !== "PAID") {
        const i = doc.issues[0];
        alerts.push({
          ...base, id: `doc-${doc.id}`, severity: "high", kind: "Document mismatch",
          title: `${doc.fileName} does not match`, detail: i ? `${i.field}: expected ${i.expected}, document says ${i.found}` : "Fields differ from PO",
          owners: ["finance", "procurement", "vendor"],
        });
      }
    }
    for (const p of v.payments) {
      if (p.status === "paid") continue;
      const days = Math.round((p.dueDate.getTime() - now.getTime()) / DAY);
      if (p.status === "on_hold") {
        alerts.push({ ...base, id: `pay-${p.id}`, severity: "high", kind: "Payment on hold", title: `${p.milestone === "advance" ? "Advance" : "Balance"} payment on hold`, detail: p.holdReason ?? "Held by finance", owners: ["finance"] });
      } else if (days < 0) {
        alerts.push({ ...base, id: `pay-${p.id}`, severity: "high", kind: "Payment overdue", title: `Payment overdue by ${-days} day${days === -1 ? "" : "s"}`, detail: `${p.milestone === "advance" ? "Advance" : "Balance"} of $${Math.round(p.amountUsd).toLocaleString("en-US")} was due per agreed terms`, owners: ["finance", "vendor"] });
      } else if (days <= 7) {
        alerts.push({ ...base, id: `pay-${p.id}`, severity: "medium", kind: "Payment due", title: `Payment due in ${days} day${days === 1 ? "" : "s"}`, detail: `${p.milestone === "advance" ? "Advance" : "Balance"} of $${Math.round(p.amountUsd).toLocaleString("en-US")}`, owners: ["finance"] });
      }
    }
  }
  alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));

  return { now, vendors, stats, views, alerts, lots, inspections, payments, docs };
});

export type Snapshot = Awaited<ReturnType<typeof getSnapshot>>;

/** What this persona is allowed to see. Vendors only ever see their own orders. */
export function scopeViews(snap: Snapshot, p: Persona) {
  return p.role === "vendor" ? snap.views.filter((v) => v.vendor.id === p.vendorId) : snap.views;
}

export function scopeAlerts(snap: Snapshot, p: Persona) {
  if (isExec(p.role) || p.role === "procurement") return snap.alerts;
  if (p.role === "vendor") return snap.alerts.filter((a) => a.vendorId === p.vendorId && a.owners.includes("vendor"));
  return snap.alerts.filter((a) => a.owners.includes(p.role));
}

export async function getPoEvents(poId: string) {
  return db.select().from(schema.events).where(eq(schema.events.poId, poId)).orderBy(desc(schema.events.at));
}

export const getTemplates = cache(async () => db.select().from(schema.qcTemplates).orderBy(asc(schema.qcTemplates.category), desc(schema.qcTemplates.updatedAt)));

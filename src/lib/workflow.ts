import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ChecklistItem, ChecklistResult, MatchIssue } from "@/db/schema";
import { DAY, fmtDate, num } from "./format";
import type { Persona, Role } from "./personas";
import { canMoveLot, canMovePo, inspectionVerdict, matchDocument, sampleSize, validateContainerNo } from "./rules";
import { sap } from "./sap/mock";

/**
 * Every state change in the app goes through this file. Each function checks
 * who is asking and what stage the PO is in, makes the change in one
 * transaction, and writes an audit event.
 */

export class WorkflowError extends Error {}
function fail(m: string): never {
  throw new WorkflowError(m);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const uid = (p: string) => `${p}-${crypto.randomUUID().slice(0, 12)}`;

async function log(tx: Tx, p: Persona | "SAP" | "Document AI", poId: string, type: string, message: string, lotId?: string) {
  const actor = typeof p === "string" ? { role: "system", name: p } : { role: p.role, name: p.name };
  await tx.insert(schema.events).values({ id: uid("ev"), poId, lotId: lotId ?? null, type, actorRole: actor.role, actorName: actor.name, message, at: new Date() });
}

async function loadPo(tx: Tx, poId: string, p: Persona) {
  const [po] = await tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, poId));
  if (!po) fail("Purchase order not found");
  if (p.role === "vendor" && po.vendorId !== p.vendorId) fail("This order belongs to another vendor");
  return po;
}

async function loadLot(tx: Tx, lotId: string, p: Persona) {
  const [lot] = await tx.select().from(schema.lots).where(eq(schema.lots.id, lotId));
  if (!lot) fail("Lot not found");
  const po = await loadPo(tx, lot.poId, p);
  return { lot, po };
}

function need(p: Persona, ...roles: Role[]) {
  if (!roles.includes(p.role)) fail(`Only ${roles.join(" / ")} can do this`);
}

// ---------------------------------------------------------------- vendor: accept → production → QC request

export async function acceptPo(p: Persona, poId: string, leadDays: number) {
  if (!Number.isInteger(leadDays) || leadDays < 7 || leadDays > 180) fail("Lead time must be between 7 and 180 days");
  await db.transaction(async (tx) => {
    const po = await loadPo(tx, poId, p);
    if (!canMovePo(po.status, "ACCEPTED", p.role)) fail("This order cannot be accepted right now");
    const [vendor] = await tx.select().from(schema.vendors).where(eq(schema.vendors.id, po.vendorId));
    const now = new Date();
    const ready = new Date(now.getTime() + leadDays * DAY);
    await tx.update(schema.purchaseOrders).set({ status: "ACCEPTED", acceptedAt: now, promisedLeadDays: leadDays, promisedReadyDate: ready }).where(eq(schema.purchaseOrders.id, poId));
    const over = leadDays - po.requestedLeadDays;
    await log(tx, p, poId, "PO_ACCEPTED", `Accepted. Promised lead time ${leadDays} days - ready by ${fmtDate(ready)}${over > 0 ? ` (${over} days longer than requested)` : ""}`);
    if (vendor.advancePct > 0) {
      await tx.insert(schema.payments).values({
        id: uid("pay"), poId, vendorId: vendor.id, milestone: "advance",
        amountUsd: Math.round((po.totalValueUsd * vendor.advancePct) / 100), dueDate: new Date(now.getTime() + 7 * DAY), status: "pending",
      });
    }
  });
}

export async function updateProduction(p: Persona, poId: string, pct: number) {
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) fail("Progress must be between 0 and 100");
  await db.transaction(async (tx) => {
    const po = await loadPo(tx, poId, p);
    if (!canMovePo(po.status, "IN_PRODUCTION", p.role)) fail("Production progress cannot be updated at this stage");
    await tx.update(schema.purchaseOrders).set({ status: "IN_PRODUCTION", productionPct: pct }).where(eq(schema.purchaseOrders.id, poId));
    await log(tx, p, poId, po.status === "ACCEPTED" ? "PRODUCTION_STARTED" : "PRODUCTION_UPDATE", po.status === "ACCEPTED" ? `Production started - ${pct}% complete` : `Production update - ${pct}% complete`);
  });
}

export async function requestQc(p: Persona, poId: string) {
  await db.transaction(async (tx) => {
    const po = await loadPo(tx, poId, p);
    if (!canMovePo(po.status, "QC_REQUESTED", p.role)) fail("QC can only be requested once goods are in production or reworked");
    const templates = await tx.select().from(schema.qcTemplates).where(and(eq(schema.qcTemplates.category, po.category), eq(schema.qcTemplates.approved, true)));
    const template = templates.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    if (!template) fail(`No approved QC checklist exists for ${po.category}s yet`);
    const prior = await tx.select().from(schema.qcInspections).where(eq(schema.qcInspections.poId, poId));
    await tx.insert(schema.qcInspections).values({
      id: uid("qc"), poId, templateId: template.id, attempt: prior.length + 1, status: "REQUESTED",
      requestedAt: new Date(), results: [], sampleSize: sampleSize(po.totalQty),
    });
    await tx.update(schema.purchaseOrders).set({ status: "QC_REQUESTED", productionPct: 100 }).where(eq(schema.purchaseOrders.id, poId));
    await log(tx, p, poId, "QC_REQUESTED", prior.length ? "Rework complete - re-inspection requested" : "Goods ready - QC inspection requested");
  });
}

// ---------------------------------------------------------------- procurement + QC

export async function scheduleQc(p: Persona, inspectionId: string, date: Date, inspector: string) {
  need(p, "procurement");
  if (!inspector.trim()) fail("Choose an inspector");
  if (Number.isNaN(date.getTime())) fail("Choose an inspection date");
  await db.transaction(async (tx) => {
    const [insp] = await tx.select().from(schema.qcInspections).where(eq(schema.qcInspections.id, inspectionId));
    if (!insp || insp.status !== "REQUESTED") fail("This inspection is not waiting to be scheduled");
    await tx.update(schema.qcInspections).set({ status: "SCHEDULED", scheduledFor: date, inspectorName: inspector }).where(eq(schema.qcInspections.id, inspectionId));
    await tx.update(schema.purchaseOrders).set({ status: "QC_SCHEDULED" }).where(eq(schema.purchaseOrders.id, insp.poId));
    await log(tx, p, insp.poId, "QC_SCHEDULED", `QC scheduled for ${fmtDate(date)} - inspector ${inspector}`);
  });
}

export async function submitInspection(p: Persona, inspectionId: string, results: ChecklistResult[], notes: string) {
  need(p, "qc");
  return db.transaction(async (tx) => {
    const [insp] = await tx.select().from(schema.qcInspections).where(eq(schema.qcInspections.id, inspectionId));
    if (!insp || insp.status !== "SCHEDULED") fail("This inspection is not open for sign-off");
    const [template] = await tx.select().from(schema.qcTemplates).where(eq(schema.qcTemplates.id, insp.templateId));
    const verdict = inspectionVerdict(template.items, results);
    if (!verdict.complete) fail(`${verdict.unanswered.length} checklist item${verdict.unanswered.length > 1 ? "s are" : " is"} still unanswered`);
    const missingNote = results.find((r) => r.result === "fail" && !r.note?.trim());
    if (missingNote) fail("Add a note on every failed check so the vendor knows what to fix");
    const now = new Date();
    const fails = verdict.criticalFails.length + verdict.minorFails.length;
    const summary =
      (verdict.passed
        ? fails
          ? `Passed with ${fails} minor observation${fails > 1 ? "s" : ""} on a sample of ${insp.sampleSize}.`
          : `All checks passed on a sample of ${insp.sampleSize}.`
        : `${fails} check${fails > 1 ? "s" : ""} failed (${verdict.criticalFails.length} critical) on a sample of ${insp.sampleSize}. Rework required before re-inspection.`) +
      (notes.trim() ? ` ${notes.trim()}` : "");
    await tx.update(schema.qcInspections).set({ status: verdict.passed ? "PASSED" : "FAILED", results, summary, completedAt: now, inspectorName: p.name }).where(eq(schema.qcInspections.id, inspectionId));
    await tx.update(schema.purchaseOrders).set(verdict.passed ? { status: "QC_PASSED", qcPassedAt: now } : { status: "QC_FAILED" }).where(eq(schema.purchaseOrders.id, insp.poId));
    await log(tx, p, insp.poId, verdict.passed ? "QC_PASSED" : "QC_FAILED", verdict.passed ? `QC passed on a sample of ${insp.sampleSize} units` : `QC failed - ${fails} check${fails > 1 ? "s" : ""} failed. Rework required`);
    return { passed: verdict.passed, poId: insp.poId };
  });
}

export async function saveTemplate(p: Persona, input: { id?: string; category: "speaker" | "soundbar"; name: string; items: ChecklistItem[]; approved: boolean; aiDrafted?: boolean }) {
  need(p, "procurement", "csco");
  if (!input.name.trim()) fail("Give the checklist a name");
  if (input.items.length < 3) fail("A checklist needs at least 3 checks");
  const id = input.id ?? uid("tpl");
  const row = { category: input.category, name: input.name.trim(), items: input.items, approved: input.approved, aiDrafted: input.aiDrafted ?? false, updatedAt: new Date() };
  await db.insert(schema.qcTemplates).values({ id, ...row }).onConflictDoUpdate({ target: schema.qcTemplates.id, set: row });
  return id;
}

// ---------------------------------------------------------------- vendor: lot + shipping

export async function createLot(p: Persona, poId: string, qty: number, cartons: number) {
  if (!Number.isInteger(qty) || qty <= 0) fail("Enter the lot quantity");
  if (!Number.isInteger(cartons) || cartons <= 0) fail("Enter the number of cartons");
  await db.transaction(async (tx) => {
    const po = await loadPo(tx, poId, p);
    if (!canMovePo(po.status, "IN_TRANSIT", p.role) || p.role !== "vendor") fail("A lot can only be created by the vendor after QC has passed");
    const existing = await tx.select().from(schema.lots).where(eq(schema.lots.poId, poId));
    const remaining = po.totalQty - existing.reduce((a, l) => a + l.qty, 0);
    if (remaining <= 0) fail("The full PO quantity is already allotted to lots");
    if (qty > remaining) fail(`Only ${num(remaining)} units remain on this PO`);
    const lotNumber = `LOT-${po.poNumber.slice(-5)}-${String(existing.length + 1).padStart(2, "0")}`;
    const id = `lot-${po.poNumber}-${existing.length + 1}`;
    await tx.insert(schema.lots).values({ id, lotNumber, poId, qty, cartons, status: "CREATED", createdAt: new Date() });
    await tx.update(schema.purchaseOrders).set({ status: "IN_TRANSIT" }).where(eq(schema.purchaseOrders.id, poId));
    await log(tx, p, poId, "LOT_CREATED", `Lot ${lotNumber} created - ${num(qty)} units in ${num(cartons)} cartons`, id);
  });
}

export type ShipInput = { containerNo: string; blNo: string; carrier: string; vessel: string; portOfLoading: string; portOfDischarge: string; etd: Date; eta: Date };

export async function shipLot(p: Persona, lotId: string, input: ShipInput) {
  const container = validateContainerNo(input.containerNo);
  if (!container.ok) return fail(container.error);
  for (const k of ["blNo", "carrier", "vessel", "portOfLoading", "portOfDischarge"] as const) if (!input[k].trim()) fail("Fill in all shipping details");
  if (Number.isNaN(input.etd.getTime()) || Number.isNaN(input.eta.getTime())) fail("Enter ETD and ETA");
  if (input.eta <= input.etd) fail("ETA must be after ETD");
  await db.transaction(async (tx) => {
    const { lot, po } = await loadLot(tx, lotId, p);
    if (!canMoveLot(lot.status, "SHIPPED", p.role)) fail("Shipping details can only be added by the vendor to a new lot");
    await tx.update(schema.lots).set({
      status: "SHIPPED", containerNo: container.value, blNo: input.blNo.trim().toUpperCase(), carrier: input.carrier.trim(), vessel: input.vessel.trim(),
      portOfLoading: input.portOfLoading.trim(), portOfDischarge: input.portOfDischarge.trim(), etd: input.etd, eta: input.eta, originalEta: input.eta, shippedAt: new Date(),
    }).where(eq(schema.lots.id, lotId));
    await log(tx, p, po.id, "LOT_SHIPPED", `Shipped in container ${container.value} on ${input.vessel.trim()} from ${input.portOfLoading.trim()}. ETA ${input.portOfDischarge.trim()} ${fmtDate(input.eta)}`, lotId);
  });
}

// ---------------------------------------------------------------- logistics

export async function updateEta(p: Persona, lotId: string, eta: Date) {
  need(p, "logistics");
  if (Number.isNaN(eta.getTime())) fail("Enter the new ETA");
  await db.transaction(async (tx) => {
    const { lot, po } = await loadLot(tx, lotId, p);
    if (lot.status !== "SHIPPED") fail("ETA can only change while the container is at sea");
    await tx.update(schema.lots).set({ eta }).where(eq(schema.lots.id, lotId));
    await log(tx, p, po.id, "ETA_CHANGED", `ETA revised from ${fmtDate(lot.eta)} to ${fmtDate(eta)}`, lotId);
  });
}

const LOT_STEP = {
  AT_PORT: { col: "arrivedAt", type: "ARRIVED_PORT", msg: (c: string, port: string) => `Container ${c} discharged at ${port}` },
  CUSTOMS_CLEARED: { col: "clearedAt", type: "CUSTOMS_CLEARED", msg: () => "Customs cleared - bill of entry filed, duty paid" },
  PICKED_UP: { col: "pickedUpAt", type: "PICKED_UP", msg: () => "Container picked up - in transit to warehouse" },
} as const;

export async function advanceLot(p: Persona, lotId: string, to: keyof typeof LOT_STEP) {
  await db.transaction(async (tx) => {
    const { lot, po } = await loadLot(tx, lotId, p);
    if (!canMoveLot(lot.status, to, p.role)) fail("This lot is not ready for that step");
    const step = LOT_STEP[to];
    await tx.update(schema.lots).set({ status: to, [step.col]: new Date() }).where(eq(schema.lots.id, lotId));
    await log(tx, p, po.id, step.type, step.msg(lot.containerNo ?? "", lot.portOfDischarge ?? "port"), lotId);
  });
}

// ---------------------------------------------------------------- warehouse: GRN → close PO

export async function receiveLot(p: Persona, lotId: string, receivedQty: number, damagedQty: number, note: string) {
  if (!Number.isInteger(receivedQty) || receivedQty < 0) fail("Enter the quantity received in good condition");
  if (!Number.isInteger(damagedQty) || damagedQty < 0) fail("Damaged quantity cannot be negative");
  return db.transaction(async (tx) => {
    const { lot, po } = await loadLot(tx, lotId, p);
    if (!canMoveLot(lot.status, "RECEIVED", p.role)) fail("Only the warehouse can receive a lot that has been picked up");
    if (receivedQty + damagedQty > lot.qty) fail(`Received + damaged (${num(receivedQty + damagedQty)}) is more than the lot quantity (${num(lot.qty)})`);
    const shortQty = lot.qty - receivedQty - damagedQty;
    if ((shortQty > 0 || damagedQty > 0) && !note.trim()) fail("Add a note explaining the shortage or damage");

    const { grnNumber } = await sap.postGoodsReceipt({ poNumber: po.poNumber, lotNumber: lot.lotNumber, receivedQty, damagedQty });
    const now = new Date();
    await tx.insert(schema.goodsReceipts).values({ id: uid("grn"), grnNumber, lotId, poId: po.id, receivedQty, damagedQty, shortQty, note: note.trim() || null, postedAt: now });
    await tx.update(schema.lots).set({ status: "RECEIVED", receivedAt: now }).where(eq(schema.lots.id, lotId));
    const extras = [damagedQty ? `${num(damagedQty)} damaged` : "", shortQty ? `${num(shortQty)} short` : ""].filter(Boolean).join(", ");
    await log(tx, p, po.id, "GRN_POSTED", `Received ${num(receivedQty)} units${extras ? `, ${extras}` : ""}. GRN ${grnNumber} posted to SAP`, lotId);

    // Close the PO once every unit ordered has been allotted to a lot and every lot is in the warehouse.
    const lots = await tx.select().from(schema.lots).where(eq(schema.lots.poId, po.id));
    const allotted = lots.reduce((a, l) => a + l.qty, 0);
    const allIn = lots.every((l) => l.id === lotId || l.status === "RECEIVED");
    let closed = false;
    if (allIn && allotted >= po.totalQty) {
      await sap.closePurchaseOrder(po.poNumber);
      const [vendor] = await tx.select().from(schema.vendors).where(eq(schema.vendors.id, po.vendorId));
      await tx.update(schema.purchaseOrders).set({ status: "CLOSED", closedAt: now }).where(eq(schema.purchaseOrders.id, po.id));
      await log(tx, "SAP", po.id, "PO_CLOSED", `All lots received - PO ${po.poNumber} closed in SAP`);

      const docs = await tx.select().from(schema.documents).where(eq(schema.documents.poId, po.id));
      const grns = await tx.select().from(schema.goodsReceipts).where(eq(schema.goodsReceipts.poId, po.id));
      const badDoc = docs.find((d) => d.type === "invoice" && d.matchStatus === "mismatch");
      const lost = grns.reduce((a, g) => a + g.shortQty + g.damagedQty, 0);
      const hold = badDoc ? "Invoice does not match PO / lot" : lost > 0 ? `${num(lost)} units short or damaged at GRN - debit note to be raised` : null;
      await tx.insert(schema.payments).values({
        id: uid("pay"), poId: po.id, vendorId: vendor.id, milestone: "balance",
        amountUsd: Math.round(po.totalValueUsd * (1 - vendor.advancePct / 100)),
        dueDate: new Date(now.getTime() + vendor.creditDays * DAY), status: hold ? "on_hold" : "pending", holdReason: hold,
      });
      closed = true;
    }
    return { grnNumber, closed, poId: po.id };
  });
}

// ---------------------------------------------------------------- finance

export async function releasePayment(p: Persona, paymentId: string) {
  need(p, "finance");
  await db.transaction(async (tx) => {
    const [pay] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
    if (!pay) fail("Payment not found");
    if (pay.status === "paid") fail("This payment has already been released");
    if (pay.status === "on_hold") fail("This payment is on hold - clear the hold first");
    await tx.update(schema.payments).set({ status: "paid", paidAt: new Date() }).where(eq(schema.payments.id, paymentId));
    await log(tx, p, pay.poId, "PAYMENT_RELEASED", `${pay.milestone === "advance" ? "Advance" : "Balance"} payment of $${Math.round(pay.amountUsd).toLocaleString("en-US")} released`);
    if (pay.milestone === "balance") await tx.update(schema.purchaseOrders).set({ status: "PAID" }).where(eq(schema.purchaseOrders.id, pay.poId));
  });
}

export async function setPaymentHold(p: Persona, paymentId: string, hold: boolean, reason: string) {
  need(p, "finance");
  if (hold && !reason.trim()) fail("Give a reason for the hold");
  await db.transaction(async (tx) => {
    const [pay] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
    if (!pay || pay.status === "paid") fail("This payment cannot be changed");
    await tx.update(schema.payments).set({ status: hold ? "on_hold" : "pending", holdReason: hold ? reason.trim() : null }).where(eq(schema.payments.id, paymentId));
    await log(tx, p, pay.poId, hold ? "PAYMENT_HELD" : "PAYMENT_HOLD_CLEARED", hold ? `Payment put on hold - ${reason.trim()}` : `Payment hold cleared${reason.trim() ? ` - ${reason.trim()}` : ""}`);
  });
}

// ---------------------------------------------------------------- documents

export async function addDocument(
  p: Persona,
  input: { poId: string; lotId: string | null; type: "packing_list" | "bill_of_lading" | "invoice" | "other"; fileName: string; storagePath: string | null; extracted: Record<string, unknown> },
) {
  return db.transaction(async (tx) => {
    const po = await loadPo(tx, input.poId, p);
    const lot = input.lotId ? (await tx.select().from(schema.lots).where(eq(schema.lots.id, input.lotId)))[0] ?? null : null;
    if (lot && lot.poId !== po.id) fail("That lot belongs to a different PO");
    const issues: MatchIssue[] = matchDocument(input.type, input.extracted, po, lot);
    const id = uid("doc");
    await tx.insert(schema.documents).values({
      id, poId: po.id, lotId: lot?.id ?? null, type: input.type, fileName: input.fileName, storagePath: input.storagePath,
      extracted: input.extracted, matchStatus: issues.length ? "mismatch" : "match", issues, uploadedBy: p.name, createdAt: new Date(),
    });
    if (issues.length) {
      await log(tx, "Document AI", po.id, "DOC_MISMATCH", `${input.fileName}: ${issues.map((i) => `${i.field} - expected ${i.expected}, found ${i.found}`).join("; ")}`, lot?.id);
      if (input.type === "invoice") {
        await tx.update(schema.payments).set({ status: "on_hold", holdReason: "Invoice does not match PO / lot" })
          .where(and(eq(schema.payments.poId, po.id), eq(schema.payments.milestone, "balance"), eq(schema.payments.status, "pending")));
      }
    } else {
      await log(tx, "Document AI", po.id, "DOC_MATCHED", `${input.fileName} read and matched against ${lot ? `lot ${lot.lotNumber}` : `PO ${po.poNumber}`}`, lot?.id);
    }
    return { id, issues };
  });
}

// ---------------------------------------------------------------- SAP sync + demo admin

export async function syncFromSap(p: Persona) {
  need(p, "procurement", "csco", "ceo");
  const incoming = await sap.fetchNewPurchaseOrders();
  const created: string[] = [];
  await db.transaction(async (tx) => {
    for (const x of incoming) {
      const id = `po-${x.poNumber}`;
      const totalQty = x.lines.reduce((a, l) => a + l.qty, 0);
      await tx.insert(schema.purchaseOrders).values({
        id, poNumber: x.poNumber, vendorId: x.vendorId, category: x.category, productName: x.productName, lines: x.lines, totalQty,
        totalValueUsd: Math.round(x.lines.reduce((a, l) => a + l.qty * l.unitPriceUsd, 0)), status: "ISSUED", issuedAt: x.issuedAt,
        requestedLeadDays: x.requestedLeadDays, productionPct: 0,
      });
      await log(tx, "SAP", id, "PO_ISSUED", `PO ${x.poNumber} issued from SAP - ${num(totalQty)} units of ${x.productName}`);
      created.push(id);
    }
  });
  return created;
}

export async function tableCounts() {
  const [r] = await db.execute<{ n: number }>(sql`select count(*)::int as n from purchase_orders`);
  return r.n;
}

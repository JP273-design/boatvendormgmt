import type { Lot, PurchaseOrder, QcInspection } from "@/db/schema";
import { DAY } from "./format";

export type VendorStats = {
  vendorId: string;
  completed: number;
  onTimePct: number | null;
  avgDelayDays: number | null;
  firstPassPct: number | null;
  docAccuracyPct: number | null;
  /** on-time % over the most recent 90 days of completions, for trend */
  recentOnTimePct: number | null;
  openPos: number;
  openValueUsd: number;
  score: number | null;
};

export type RiskFactor = { label: string; detail: string; points: number; owner: "vendor" | "boat" };
export type Risk = {
  score: number;
  level: "low" | "medium" | "high";
  factors: RiskFactor[];
  /** best estimate of days late against the promised ready date / original ETA */
  projectedDelayDays: number;
};

const d = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY;

/**
 * Transparent, rules-based delay risk. Every point is traceable to a factor,
 * so a human (or Claude) can explain exactly why a PO is flagged.
 */
export function scorePo(
  po: PurchaseOrder,
  lots: Lot[],
  inspections: QcInspection[],
  vendor: VendorStats | undefined,
  now: Date,
): Risk {
  const factors: RiskFactor[] = [];
  let projected = 0;
  const add = (points: number, label: string, detail: string, owner: RiskFactor["owner"] = "vendor") =>
    factors.push({ points: Math.round(points), label, detail, owner });

  if (po.status === "CLOSED" || po.status === "PAID") {
    return { score: 0, level: "low", factors, projectedDelayDays: 0 };
  }

  const preShipment = !["IN_TRANSIT"].includes(po.status);

  if (po.status === "ISSUED") {
    const waiting = d(po.issuedAt, now);
    if (waiting > 3) add(Math.min(40, 15 + waiting * 3), "Not accepted yet", `Vendor has not accepted the PO ${Math.floor(waiting)} days after issue`);
  }

  if ((po.status === "ACCEPTED" || po.status === "IN_PRODUCTION") && po.acceptedAt && po.promisedReadyDate) {
    const window = d(po.acceptedAt, po.promisedReadyDate) - 4;
    const planned = Math.max(0, Math.min(1, d(po.acceptedAt, now) / window));
    const gap = planned - po.productionPct / 100;
    if (gap > 0.1) {
      const slip = Math.round(gap * window);
      projected = Math.max(projected, slip);
      add(Math.min(45, gap * 130), "Production behind plan", `Reported ${po.productionPct}% complete; plan needs ${Math.round(planned * 100)}% by today - about ${slip} days behind`);
    }
  }

  if (preShipment && po.promisedReadyDate && !po.qcPassedAt) {
    const over = d(po.promisedReadyDate, now);
    if (over > 0) {
      projected = Math.max(projected, Math.ceil(over) + 4);
      add(Math.min(50, 22 + over * 2), "Promised date missed", `Ready date was ${Math.ceil(over)} days ago and QC has not passed`);
    }
  }

  if (po.status === "QC_FAILED") {
    projected = Math.max(projected, 8);
    add(32, "QC failed", "Rework and re-inspection typically add 7-10 days");
  }

  if (po.status === "QC_REQUESTED") {
    const open = inspections.find((i) => i.status === "REQUESTED");
    const waiting = open ? d(open.requestedAt, now) : 0;
    if (waiting > 2) add(Math.min(30, 10 + waiting * 4), "QC not scheduled", `Vendor asked for inspection ${Math.floor(waiting)} days ago - goods are waiting on us`, "boat");
  }

  if (preShipment && vendor) {
    if (vendor.onTimePct !== null && vendor.onTimePct < 75) {
      add(Math.min(25, (75 - vendor.onTimePct) * 0.7), "Vendor track record", `On time on only ${Math.round(vendor.onTimePct)}% of ${vendor.completed} orders, ${Math.round(vendor.avgDelayDays ?? 0)} days late on average`);
      if (!projected && (vendor.avgDelayDays ?? 0) > 3) projected = Math.round(vendor.avgDelayDays!);
    }
    if (!po.qcPassedAt && po.status !== "QC_FAILED" && vendor.firstPassPct !== null && vendor.firstPassPct < 80) {
      add(10, "QC history", `Only ${Math.round(vendor.firstPassPct)}% of this vendor's orders pass QC first time`);
    }
  }

  for (const lot of lots) {
    const tag = lot.lotNumber;
    if (lot.status === "CREATED" && d(lot.createdAt, now) > 4) {
      add(15, "Shipping details missing", `${tag} created ${Math.floor(d(lot.createdAt, now))} days ago with no container booked`);
    }
    if (lot.status === "SHIPPED" && lot.eta && lot.originalEta) {
      const slip = d(lot.originalEta, lot.eta);
      if (slip >= 1) {
        projected = Math.max(projected, Math.round(slip));
        add(Math.min(35, 10 + slip * 4), "ETA slipped", `${tag}: carrier moved ETA by ${Math.round(slip)} days`);
      }
      const overdue = d(lot.eta, now);
      if (overdue > 1) add(Math.min(30, 10 + overdue * 4), "Arrival overdue", `${tag}: ETA passed ${Math.floor(overdue)} days ago with no arrival confirmed`, "boat");
    }
    if (lot.status === "AT_PORT" && lot.arrivedAt) {
      const days = d(lot.arrivedAt, now);
      if (days > 4) {
        projected = Math.max(projected, Math.round(days - 3));
        add(Math.min(70, 25 + days * 3), "Stuck at port", `${tag}: ${Math.floor(days)} days at ${lot.portOfDischarge} without customs clearance - demurrage is accruing`, "boat");
      }
    }
    if (lot.status === "CUSTOMS_CLEARED" && lot.clearedAt && d(lot.clearedAt, now) > 2) {
      add(18, "Pickup pending", `${tag}: cleared ${Math.floor(d(lot.clearedAt, now))} days ago, not picked up`, "boat");
    }
    if (lot.status === "PICKED_UP" && lot.pickedUpAt && d(lot.pickedUpAt, now) > 3) {
      add(15, "GRN pending", `${tag}: picked up ${Math.floor(d(lot.pickedUpAt, now))} days ago, not yet received in SAP`, "boat");
    }
  }

  const score = Math.min(100, factors.reduce((a, f) => a + f.points, 0));
  factors.sort((a, b) => b.points - a.points);
  return { score, level: score >= 60 ? "high" : score >= 30 ? "medium" : "low", factors, projectedDelayDays: projected };
}

/** Vendor scorecard from order history. */
export function vendorStats(
  vendorId: string,
  pos: PurchaseOrder[],
  inspections: QcInspection[],
  docs: { poId: string; matchStatus: string }[],
  now: Date,
): VendorStats {
  const mine = pos.filter((p) => p.vendorId === vendorId);
  const ids = new Set(mine.map((p) => p.id));
  const done = mine.filter((p) => p.qcPassedAt && p.promisedReadyDate);
  const delay = (p: PurchaseOrder) => d(p.promisedReadyDate!, p.qcPassedAt!);
  const onTime = (list: PurchaseOrder[]) => (list.length ? (list.filter((p) => delay(p) <= 1).length / list.length) * 100 : null);
  const recent = done.filter((p) => d(p.qcPassedAt!, now) <= 120);

  const first = inspections.filter((i) => ids.has(i.poId) && i.attempt === 1 && i.completedAt);
  const firstPassPct = first.length ? (first.filter((i) => i.status === "PASSED").length / first.length) * 100 : null;

  const myDocs = docs.filter((x) => ids.has(x.poId));
  const docAccuracyPct = myDocs.length ? (myDocs.filter((x) => x.matchStatus === "match").length / myDocs.length) * 100 : null;

  const open = mine.filter((p) => p.status !== "PAID" && p.status !== "CLOSED");
  const onTimePct = onTime(done);
  const score =
    onTimePct === null || firstPassPct === null
      ? null
      : Math.round(onTimePct * 0.5 + firstPassPct * 0.35 + (docAccuracyPct ?? 100) * 0.15);

  return {
    vendorId,
    completed: done.length,
    onTimePct,
    avgDelayDays: done.length ? done.reduce((a, p) => a + Math.max(0, delay(p)), 0) / done.length : null,
    firstPassPct,
    docAccuracyPct,
    recentOnTimePct: onTime(recent),
    openPos: open.length,
    openValueUsd: open.reduce((a, p) => a + p.totalValueUsd, 0),
    score,
  };
}

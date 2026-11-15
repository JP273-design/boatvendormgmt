import type {
  ChecklistItem,
  ChecklistResult,
  Lot,
  LotStatus,
  MatchIssue,
  PoStatus,
  PurchaseOrder,
} from "@/db/schema";
import { LOT_STATUSES } from "@/db/schema";
import type { Role } from "./personas";

/** Pure workflow rules - no database, unit-tested in rules.test.ts. */

/** Who may move a PO out of each stage, and where it can go. */
export const PO_TRANSITIONS: Record<PoStatus, { to: PoStatus[]; by: Role[] }> = {
  ISSUED: { to: ["ACCEPTED"], by: ["vendor"] },
  ACCEPTED: { to: ["IN_PRODUCTION"], by: ["vendor"] },
  IN_PRODUCTION: { to: ["IN_PRODUCTION", "QC_REQUESTED"], by: ["vendor"] },
  QC_REQUESTED: { to: ["QC_SCHEDULED"], by: ["procurement"] },
  QC_SCHEDULED: { to: ["QC_PASSED", "QC_FAILED"], by: ["qc"] },
  QC_FAILED: { to: ["QC_REQUESTED"], by: ["vendor"] },
  QC_PASSED: { to: ["IN_TRANSIT"], by: ["vendor"] },
  IN_TRANSIT: { to: ["IN_TRANSIT", "CLOSED"], by: ["vendor", "logistics", "warehouse"] },
  CLOSED: { to: ["PAID"], by: ["finance"] },
  PAID: { to: [], by: [] },
};

export const LOT_TRANSITIONS: Record<LotStatus, { to: LotStatus | null; by: Role | null }> = {
  CREATED: { to: "SHIPPED", by: "vendor" },
  SHIPPED: { to: "AT_PORT", by: "logistics" },
  AT_PORT: { to: "CUSTOMS_CLEARED", by: "logistics" },
  CUSTOMS_CLEARED: { to: "PICKED_UP", by: "logistics" },
  PICKED_UP: { to: "RECEIVED", by: "warehouse" },
  RECEIVED: { to: null, by: null },
};

export function canMovePo(from: PoStatus, to: PoStatus, role: Role) {
  const t = PO_TRANSITIONS[from];
  return t.to.includes(to) && t.by.includes(role);
}

export function canMoveLot(from: LotStatus, to: LotStatus, role: Role) {
  const t = LOT_TRANSITIONS[from];
  return t.to === to && t.by === role;
}

/**
 * QC verdict: any failed critical check fails the lot; more than two failed
 * minor checks also fails it. Every item must be answered.
 */
export function inspectionVerdict(items: ChecklistItem[], results: ChecklistResult[]) {
  const byId = new Map(results.map((r) => [r.itemId, r]));
  const unanswered = items.filter((i) => !byId.has(i.id));
  const failed = items.filter((i) => byId.get(i.id)?.result === "fail");
  const criticalFails = failed.filter((i) => i.critical);
  const minorFails = failed.filter((i) => !i.critical);
  const passed = unanswered.length === 0 && criticalFails.length === 0 && minorFails.length <= 2;
  return { passed, complete: unanswered.length === 0, criticalFails, minorFails, unanswered };
}

/** AQL general inspection level II sample size. */
export function sampleSize(qty: number) {
  if (qty <= 500) return 50;
  if (qty <= 1200) return 80;
  if (qty <= 3200) return 125;
  if (qty <= 10000) return 200;
  if (qty <= 35000) return 315;
  return 500;
}

/** ISO 6346 container number check digit (e.g. MSKU1234565). */
export function containerCheckDigit(first10: string) {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = first10[i];
    let v: number;
    if (c >= "0" && c <= "9") v = Number(c);
    else {
      // A=10, B=12 ... skipping multiples of 11
      v = 10 + (c.charCodeAt(0) - 65);
      v += Math.floor((v - 1) / 10);
    }
    sum += v * 2 ** i;
  }
  return (sum % 11) % 10;
}

export function validateContainerNo(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{4}\d{7}$/.test(value)) return { ok: false, error: "Container number must be 4 letters + 7 digits, e.g. MSKU1234565" };
  const expected = containerCheckDigit(value.slice(0, 10));
  if (expected !== Number(value[10])) {
    return { ok: false, error: `Container number fails its check digit (last digit should be ${expected}) - likely a typo` };
  }
  return { ok: true, value };
}

/** Index into MILESTONES for the progress bar. */
export function milestoneIndex(status: PoStatus, lots: Pick<Lot, "status">[]) {
  switch (status) {
    case "ISSUED": return 0;
    case "ACCEPTED": return 1;
    case "IN_PRODUCTION": return 2;
    case "QC_REQUESTED":
    case "QC_SCHEDULED":
    case "QC_FAILED":
    case "QC_PASSED": return 3;
    case "IN_TRANSIT": {
      const lag = laggingLot(lots);
      if (!lag || lag === "CREATED") return 3;
      if (lag === "SHIPPED") return 4;
      return 5;
    }
    case "CLOSED": return 6;
    case "PAID": return 7;
  }
}

export function laggingLot(lots: Pick<Lot, "status">[]): LotStatus | null {
  if (!lots.length) return null;
  return lots.map((l) => l.status).sort((a, b) => LOT_STATUSES.indexOf(a) - LOT_STATUSES.indexOf(b))[0];
}

const norm = (v: unknown) => String(v ?? "").replace(/[\s,-]/g, "").toUpperCase();
const asNum = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const digits = String(v ?? "").replace(/[^0-9.]/g, "");
  if (!digits) return null; // field absent from the document - nothing to compare
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
};

/** Compare fields Claude read off a document with what the system knows. */
export function matchDocument(
  type: "packing_list" | "bill_of_lading" | "invoice" | "other",
  x: Record<string, unknown>,
  po: Pick<PurchaseOrder, "poNumber" | "totalQty" | "lines">,
  lot: Pick<Lot, "lotNumber" | "qty" | "cartons" | "containerNo" | "blNo"> | null,
): MatchIssue[] {
  const issues: MatchIssue[] = [];
  const qty = lot?.qty ?? po.totalQty;
  const scope = lot ? `lot ${lot.lotNumber}` : `PO ${po.poNumber}`;
  const text = (field: string, expected: string | null | undefined, found: unknown) => {
    if (!expected || found === undefined || found === null || found === "") return;
    if (norm(expected) !== norm(found)) issues.push({ field, expected, found: String(found) });
  };
  const number = (field: string, expected: number | null | undefined, found: unknown, unit = "", tolerance = 0) => {
    const f = asNum(found);
    if (expected === null || expected === undefined || f === null) return;
    if (Math.abs(expected - f) > tolerance) {
      issues.push({ field, expected: `${expected.toLocaleString("en-US")}${unit} (${scope})`, found: `${f.toLocaleString("en-US")}${unit}` });
    }
  };

  if (type === "packing_list") {
    text("PO number", po.poNumber, x.poNumber);
    number("Quantity", qty, x.totalUnits, " units");
    number("Cartons", lot?.cartons, x.totalCartons, " cartons");
    text("Container number", lot?.containerNo, x.containerNo);
  } else if (type === "bill_of_lading") {
    text("B/L number", lot?.blNo, x.blNumber);
    text("Container number", lot?.containerNo, x.containerNo);
    number("Cartons", lot?.cartons, x.cartons, " cartons");
  } else if (type === "invoice") {
    text("PO number", po.poNumber, x.poNumber);
    number("Quantity", qty, x.quantity, " units");
    const price = po.lines[0]?.unitPriceUsd;
    number("Unit price (USD)", price, x.unitPriceUsd, "", 0.005);
    if (price !== undefined) number("Invoice value (USD)", Math.round(qty * price), x.totalUsd, "", 1);
  }
  return issues;
}

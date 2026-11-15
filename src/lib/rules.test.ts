import { describe, expect, it } from "vitest";
import type { ChecklistItem, Lot, PurchaseOrder, QcInspection } from "@/db/schema";
import { scorePo, vendorStats, type VendorStats } from "./risk";
import { canMoveLot, canMovePo, containerCheckDigit, inspectionVerdict, matchDocument, milestoneIndex, sampleSize, validateContainerNo } from "./rules";

const DAY = 86_400_000;
const now = new Date("2026-11-15T06:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * DAY);

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po-1", poNumber: "4500000001", vendorId: "v1", category: "speaker", productName: "boAt Stone 650",
  lines: [{ sku: "SPK", description: "x", qty: 1000, unitPriceUsd: 10 }], totalQty: 1000, totalValueUsd: 10000,
  status: "IN_PRODUCTION", issuedAt: ago(30), requestedLeadDays: 40, acceptedAt: ago(29), promisedLeadDays: 40,
  promisedReadyDate: new Date(ago(29).getTime() + 40 * DAY), productionPct: 70, qcPassedAt: null, closedAt: null, ...over,
});

const lot = (over: Partial<Lot> = {}): Lot => ({
  id: "lot-1", lotNumber: "LOT-00001-01", poId: "po-1", qty: 1000, cartons: 50, status: "SHIPPED", createdAt: ago(20),
  containerNo: "CSQU3054383", blNo: "BL123", carrier: "COSCO", vessel: "V", portOfLoading: "Yantian", portOfDischarge: "Nhava Sheva (JNPT)",
  etd: ago(18), originalEta: ago(-2), eta: ago(-2), shippedAt: ago(18), arrivedAt: null, clearedAt: null, pickedUpAt: null, receivedAt: null, ...over,
});

const goodVendor: VendorStats = { vendorId: "v1", completed: 10, onTimePct: 95, avgDelayDays: 0.2, firstPassPct: 95, docAccuracyPct: 100, recentOnTimePct: 95, openPos: 2, openValueUsd: 1, score: 95 };

describe("workflow transitions", () => {
  it("only the vendor can accept an issued PO", () => {
    expect(canMovePo("ISSUED", "ACCEPTED", "vendor")).toBe(true);
    expect(canMovePo("ISSUED", "ACCEPTED", "procurement")).toBe(false);
  });
  it("stages cannot be skipped", () => {
    expect(canMovePo("ISSUED", "QC_REQUESTED", "vendor")).toBe(false);
    expect(canMovePo("IN_PRODUCTION", "IN_TRANSIT", "vendor")).toBe(false);
    expect(canMovePo("QC_FAILED", "IN_TRANSIT", "vendor")).toBe(false);
  });
  it("a failed QC goes back to the vendor for re-request", () => {
    expect(canMovePo("QC_FAILED", "QC_REQUESTED", "vendor")).toBe(true);
  });
  it("only finance marks a closed PO as paid", () => {
    expect(canMovePo("CLOSED", "PAID", "finance")).toBe(true);
    expect(canMovePo("CLOSED", "PAID", "vendor")).toBe(false);
  });
  it("lots move one step at a time, by the right role", () => {
    expect(canMoveLot("CREATED", "SHIPPED", "vendor")).toBe(true);
    expect(canMoveLot("SHIPPED", "AT_PORT", "logistics")).toBe(true);
    expect(canMoveLot("SHIPPED", "CUSTOMS_CLEARED", "logistics")).toBe(false);
    expect(canMoveLot("PICKED_UP", "RECEIVED", "warehouse")).toBe(true);
    expect(canMoveLot("PICKED_UP", "RECEIVED", "logistics")).toBe(false);
  });
});

describe("QC verdict", () => {
  const items: ChecklistItem[] = [
    { id: "a", section: "s", check: "critical one", method: "", critical: true },
    { id: "b", section: "s", check: "minor 1", method: "", critical: false },
    { id: "c", section: "s", check: "minor 2", method: "", critical: false },
    { id: "d", section: "s", check: "minor 3", method: "", critical: false },
  ];
  const r = (...res: ("pass" | "fail" | "na")[]) => res.map((result, i) => ({ itemId: items[i].id, result }));

  it("passes when everything passes", () => expect(inspectionVerdict(items, r("pass", "pass", "pass", "na")).passed).toBe(true));
  it("fails on a single critical failure", () => expect(inspectionVerdict(items, r("fail", "pass", "pass", "pass")).passed).toBe(false));
  it("tolerates up to two minor failures", () => expect(inspectionVerdict(items, r("pass", "fail", "fail", "pass")).passed).toBe(true));
  it("fails on three minor failures", () => expect(inspectionVerdict(items, r("pass", "fail", "fail", "fail")).passed).toBe(false));
  it("is incomplete until every check is answered", () => {
    const v = inspectionVerdict(items, r("pass", "pass"));
    expect(v.complete).toBe(false);
    expect(v.passed).toBe(false);
    expect(v.unanswered).toHaveLength(2);
  });
  it("uses AQL level II sample sizes", () => {
    expect(sampleSize(3000)).toBe(125);
    expect(sampleSize(9000)).toBe(200);
    expect(sampleSize(20000)).toBe(315);
  });
});

describe("container numbers (ISO 6346)", () => {
  it("computes the check digit", () => expect(containerCheckDigit("CSQU305438")).toBe(3));
  it("accepts a valid number and normalises it", () => expect(validateContainerNo("csqu 305438-3")).toEqual({ ok: true, value: "CSQU3054383" }));
  it("catches a typo", () => expect(validateContainerNo("CSQU3054384").ok).toBe(false));
  it("rejects the wrong shape", () => expect(validateContainerNo("ABC123").ok).toBe(false));
});

describe("document matching", () => {
  const p = po();
  const l = lot();
  it("matches a correct packing list", () => {
    expect(matchDocument("packing_list", { poNumber: "4500000001", totalUnits: 1000, totalCartons: 50, containerNo: "CSQU 3054383" }, p, l)).toEqual([]);
  });
  it("flags an over-billed invoice on quantity and value", () => {
    const issues = matchDocument("invoice", { poNumber: "4500000001", quantity: 1200, unitPriceUsd: 10, totalUsd: 12000 }, p, l);
    expect(issues.map((i) => i.field)).toEqual(["Quantity", "Invoice value (USD)"]);
  });
  it("flags a wrong container on the bill of lading", () => {
    const issues = matchDocument("bill_of_lading", { blNumber: "BL123", containerNo: "MSKU1111111", cartons: 50 }, p, l);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("Container number");
  });
  it("ignores fields the document does not carry", () => {
    expect(matchDocument("invoice", { poNumber: "4500000001" }, p, l)).toEqual([]);
  });
  it("reads numbers printed with separators", () => {
    expect(matchDocument("packing_list", { totalUnits: "1,000 pcs" }, p, l)).toEqual([]);
  });
});

describe("milestones", () => {
  it("tracks the slowest lot while shipping", () => {
    expect(milestoneIndex("IN_TRANSIT", [{ status: "RECEIVED" }, { status: "SHIPPED" }])).toBe(4);
    expect(milestoneIndex("IN_TRANSIT", [{ status: "AT_PORT" }])).toBe(5);
    expect(milestoneIndex("PAID", [])).toBe(7);
  });
});

describe("delay risk", () => {
  it("is low for an on-plan order with a reliable vendor", () => {
    const r = scorePo(po({ productionPct: 80 }), [], [], goodVendor, now);
    expect(r.level).toBe("low");
  });
  it("flags production running behind plan and projects the slip", () => {
    const r = scorePo(po({ productionPct: 30 }), [], [], goodVendor, now);
    expect(r.factors[0].label).toBe("Production behind plan");
    expect(r.projectedDelayDays).toBeGreaterThan(10);
    expect(r.level).not.toBe("low");
  });
  it("is high when the promised date has passed and the vendor has a poor record", () => {
    const late = po({ acceptedAt: ago(50), promisedReadyDate: ago(8), productionPct: 80 });
    const r = scorePo(late, [], [], { ...goodVendor, onTimePct: 50, avgDelayDays: 9 }, now);
    expect(r.level).toBe("high");
    expect(r.factors.map((f) => f.label)).toContain("Vendor track record");
  });
  it("puts an unscheduled QC request on boAt, not the vendor", () => {
    const insp = { status: "REQUESTED", requestedAt: ago(5) } as QcInspection;
    const r = scorePo(po({ status: "QC_REQUESTED", productionPct: 100 }), [], [insp], goodVendor, now);
    expect(r.factors.find((f) => f.label === "QC not scheduled")?.owner).toBe("boat");
  });
  it("is high for a container stuck at port", () => {
    const r = scorePo(po({ status: "IN_TRANSIT", qcPassedAt: ago(40) }), [lot({ status: "AT_PORT", arrivedAt: ago(15) })], [], goodVendor, now);
    expect(r.level).toBe("high");
    expect(r.factors[0].label).toBe("Stuck at port");
  });
  it("scores closed orders as zero", () => {
    expect(scorePo(po({ status: "CLOSED" }), [], [], goodVendor, now).score).toBe(0);
  });
});

describe("vendor scorecard", () => {
  it("computes on-time and first-pass rates from history", () => {
    const pos = [
      po({ id: "a", status: "PAID", promisedReadyDate: ago(100), qcPassedAt: ago(100) }),
      po({ id: "b", status: "PAID", promisedReadyDate: ago(90), qcPassedAt: ago(80) }),
    ];
    const insp = [
      { poId: "a", attempt: 1, status: "PASSED", completedAt: ago(100) },
      { poId: "b", attempt: 1, status: "FAILED", completedAt: ago(88) },
      { poId: "b", attempt: 2, status: "PASSED", completedAt: ago(80) },
    ] as QcInspection[];
    const s = vendorStats("v1", pos, insp, [], now);
    expect(s.onTimePct).toBe(50);
    expect(s.firstPassPct).toBe(50);
    expect(s.avgDelayDays).toBe(5);
    expect(s.openPos).toBe(0);
  });
});

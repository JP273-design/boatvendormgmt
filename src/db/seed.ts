import { sql } from "drizzle-orm";
import type { Db } from "./index";
import * as s from "./schema";
import type { Category, ChecklistItem, ChecklistResult, LotStatus, PoStatus } from "./schema";
import { containerCheckDigit } from "../lib/rules";

/**
 * Demo data. Every PO is "played" forward from its issue date with vendor-specific
 * behaviour until the clock reaches today, so stages, dates, payments and history
 * are always internally consistent and fresh relative to the day you seed.
 */

const DAY = 86_400_000;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SPEAKER_ITEMS: ChecklistItem[] = [
  { id: "s1", section: "Packaging & labelling", check: "Master carton marking matches PO (SKU, qty, PO number, gross weight)", method: "Visual check against PO", critical: false },
  { id: "s2", section: "Packaging & labelling", check: "BIS (CRS) registration mark and MRP label on gift box", method: "Visual check, 10 boxes", critical: true },
  { id: "s3", section: "Packaging & labelling", check: "Accessories complete - USB-C cable, manual, warranty card", method: "Open 5 gift boxes", critical: false },
  { id: "s4", section: "Appearance", check: "No scratches, dents or colour mismatch vs golden sample", method: "Visual under 600 lux", critical: false },
  { id: "s5", section: "Appearance", check: "Logo print adhesion", method: "3M tape test", critical: false },
  { id: "s6", section: "Function", check: "Power on/off, button response and LED indicators", method: "Manual, full sample", critical: true },
  { id: "s7", section: "Function", check: "Bluetooth pairing within 5 s, stable at 10 m", method: "Pair with 2 phones", critical: true },
  { id: "s8", section: "Function", check: "TWS pairing, AUX and TF card modes", method: "Manual", critical: false },
  { id: "s9", section: "Audio", check: "Rated output power at 1 kHz, THD below 10%", method: "Audio analyser", critical: true },
  { id: "s10", section: "Audio", check: "No rattle or buzz on 80 Hz - 16 kHz sweep at max volume", method: "Frequency sweep", critical: true },
  { id: "s11", section: "Battery & charging", check: "Playtime at 60% volume meets spec", method: "Discharge test, 3 units", critical: true },
  { id: "s12", section: "Battery & charging", check: "Charging current and full-charge cut-off", method: "USB power meter", critical: true },
  { id: "s13", section: "Safety & reliability", check: "Drop test 1 m, 6 faces, in gift box", method: "ISTA 1A", critical: false },
  { id: "s14", section: "Safety & reliability", check: "IPX7 water resistance", method: "Immersion 1 m, 30 min, 2 units", critical: true },
];

export const SOUNDBAR_ITEMS: ChecklistItem[] = [
  { id: "b1", section: "Packaging & labelling", check: "Master carton marking matches PO (SKU, qty, PO number, gross weight)", method: "Visual check against PO", critical: false },
  { id: "b2", section: "Packaging & labelling", check: "BIS (CRS) mark on bar, subwoofer and power adaptor; MRP label on box", method: "Visual check, 10 boxes", critical: true },
  { id: "b3", section: "Packaging & labelling", check: "Accessories complete - remote, batteries, HDMI cable, wall-mount kit, manual", method: "Open 5 boxes", critical: false },
  { id: "b4", section: "Appearance", check: "Grille, fabric and finish free of dents, loose threads, colour mismatch", method: "Visual under 600 lux", critical: false },
  { id: "b5", section: "Function", check: "HDMI ARC handshake and audio return with reference TV", method: "Functional test", critical: true },
  { id: "b6", section: "Function", check: "Bluetooth, optical, AUX and USB inputs", method: "Manual, each input", critical: true },
  { id: "b7", section: "Function", check: "Wireless subwoofer auto-pairs within 10 s", method: "Power cycle 3 times", critical: true },
  { id: "b8", section: "Function", check: "Remote control - all keys, 8 m range", method: "Manual", critical: false },
  { id: "b9", section: "Audio", check: "Rated RMS output, THD below 10%", method: "Audio analyser", critical: true },
  { id: "b10", section: "Audio", check: "No cabinet rattle or port noise on sweep at max volume", method: "Frequency sweep", critical: true },
  { id: "b11", section: "Audio", check: "EQ modes (Movie, Music, News) switch correctly", method: "Manual", critical: false },
  { id: "b12", section: "Safety & reliability", check: "Hi-pot and earth leakage on mains input", method: "Hi-pot tester 3 kV", critical: true },
  { id: "b13", section: "Safety & reliability", check: "4-hour burn-in at 80% volume, no shutdown", method: "Burn-in rack, 5 units", critical: true },
  { id: "b14", section: "Safety & reliability", check: "Carton drop test 76 cm, 10 drops", method: "ISTA 1A", critical: false },
];

type VendorProfile = {
  id: string;
  name: string;
  city: string;
  contactName: string;
  advancePct: number;
  creditDays: number;
  /** mean days late on ready date, and spread */
  lateMean: number;
  lateSpread: number;
  /** chance the first QC attempt fails */
  qcFailRate: number;
  /** checklist items this vendor tends to fail */
  weakItems: { speaker: string[]; soundbar: string[] };
  port: string;
};

const VENDORS: VendorProfile[] = [
  { id: "v-sonicwave", name: "Shenzhen SonicWave Electronics Co.", city: "Shenzhen", contactName: "Li Wei", advancePct: 30, creditDays: 45, lateMean: -1, lateSpread: 3, qcFailRate: 0.06, weakItems: { speaker: ["s4"], soundbar: ["b4"] }, port: "Yantian" },
  { id: "v-harmony", name: "Dongguan Harmony Acoustics Ltd.", city: "Dongguan", contactName: "Zhang Min", advancePct: 20, creditDays: 60, lateMean: 6, lateSpread: 8, qcFailRate: 0.15, weakItems: { speaker: ["s7", "s1"], soundbar: ["b7", "b1"] }, port: "Shekou" },
  { id: "v-brightsound", name: "Huizhou BrightSound Technology", city: "Huizhou", contactName: "Chen Jing", advancePct: 30, creditDays: 30, lateMean: 1, lateSpread: 3, qcFailRate: 0.38, weakItems: { speaker: ["s11", "s12", "s2"], soundbar: ["b13", "b2", "b10"] }, port: "Yantian" },
  { id: "v-goldenear", name: "Shenzhen GoldenEar Audio Mfg.", city: "Shenzhen", contactName: "Wang Fang", advancePct: 0, creditDays: 60, lateMean: 0, lateSpread: 2, qcFailRate: 0.08, weakItems: { speaker: ["s13"], soundbar: ["b14"] }, port: "Shekou" },
  { id: "v-pearltone", name: "Dongguan PearlTone Electronics", city: "Dongguan", contactName: "Liu Yang", advancePct: 25, creditDays: 45, lateMean: 1, lateSpread: 4, qcFailRate: 0.18, weakItems: { speaker: ["s10", "s5"], soundbar: ["b10", "b8"] }, port: "Nansha" },
];

type Product = { name: string; sku: string; category: Category; price: number; perCarton: number };
const PRODUCTS: Product[] = [
  { name: "Stone 350 Pro", sku: "SPK-ST350P", category: "speaker", price: 7.4, perCarton: 40 },
  { name: "Stone 650", sku: "SPK-ST650", category: "speaker", price: 13.2, perCarton: 24 },
  { name: "Stone 1200F", sku: "SPK-ST1200F", category: "speaker", price: 24.5, perCarton: 12 },
  { name: "Stone Spinx 2.0", sku: "SPK-SPINX2", category: "speaker", price: 18.9, perCarton: 16 },
  { name: "Aavante Bar 1160", sku: "SBR-AV1160", category: "soundbar", price: 27.8, perCarton: 6 },
  { name: "Aavante Bar 1500", sku: "SBR-AV1500", category: "soundbar", price: 41.5, perCarton: 4 },
  { name: "Aavante Bar 2060", sku: "SBR-AV2060", category: "soundbar", price: 66.0, perCarton: 2 },
];
const COLOURS = ["Black", "Blue", "Grey"];
const CARRIERS = [
  { carrier: "Maersk", prefix: "MSKU", vessels: ["Maersk Saltoro", "Maersk Hangzhou Bay"] },
  { carrier: "MSC", prefix: "MSCU", vessels: ["MSC Aurelia", "MSC Kalina Star"] },
  { carrier: "COSCO", prefix: "CSNU", vessels: ["COSCO Jade River", "COSCO Pearl Delta"] },
  { carrier: "ONE", prefix: "ONEU", vessels: ["ONE Triumphal", "ONE Meridian"] },
];
const DISCHARGE_PORTS = ["Nhava Sheva (JNPT)", "Nhava Sheva (JNPT)", "Mundra", "Chennai"];
const INSPECTORS = ["Rohan Mehta", "Priya Nair", "Arjun Rao"];

type Spec = {
  vendor: string;
  product: number;
  qty: number;
  issuedDaysAgo: number;
  leadDays: number;
  /** override vendor lateness (days late on ready date) */
  late?: number;
  qcFail?: boolean;
  /** production runs this far behind plan (0-1) while in production */
  prodLag?: number;
  /** split into two lots; second lot ships this many days after the first */
  splitSecondLotAfter?: number;
  transitDays?: number;
  etaSlipDays?: number;
  customsDays?: number;
  invoiceQtyOver?: number;
  /** stop automatic progress at this stage, as if waiting on a human */
  holdAt?: PoStatus | LotStatus;
  dischargePort?: string;
};

/** Live POs with deliberate stories. History is generated below. */
const ACTIVE: Spec[] = [
  // just issued, waiting for vendor to accept
  { vendor: "v-sonicwave", product: 1, qty: 12000, issuedDaysAgo: 1, leadDays: 40, holdAt: "ISSUED" },
  { vendor: "v-pearltone", product: 4, qty: 3000, issuedDaysAgo: 2, leadDays: 45, holdAt: "ISSUED" },
  // accepted / early production
  { vendor: "v-goldenear", product: 0, qty: 20000, issuedDaysAgo: 6, leadDays: 38 },
  { vendor: "v-brightsound", product: 5, qty: 2400, issuedDaysAgo: 9, leadDays: 45 },
  // in production, on track
  { vendor: "v-sonicwave", product: 2, qty: 6000, issuedDaysAgo: 22, leadDays: 42 },
  { vendor: "v-goldenear", product: 4, qty: 3600, issuedDaysAgo: 27, leadDays: 45 },
  { vendor: "v-pearltone", product: 3, qty: 8000, issuedDaysAgo: 18, leadDays: 40, prodLag: 0.12 },
  // STORY: chronically late vendor, production far behind, ready date near
  { vendor: "v-harmony", product: 6, qty: 1800, issuedDaysAgo: 41, leadDays: 45, late: 14, prodLag: 0.34 },
  { vendor: "v-harmony", product: 1, qty: 10000, issuedDaysAgo: 30, leadDays: 40, late: 10, prodLag: 0.25 },
  // promised date already passed, still in production
  { vendor: "v-harmony", product: 4, qty: 4200, issuedDaysAgo: 52, leadDays: 42, late: 16, prodLag: 0.2 },
  // QC requested, procurement has not scheduled yet
  { vendor: "v-sonicwave", product: 0, qty: 16000, issuedDaysAgo: 40, leadDays: 38, late: 0, holdAt: "QC_REQUESTED" },
  { vendor: "v-pearltone", product: 5, qty: 2000, issuedDaysAgo: 47, leadDays: 44, late: 2, holdAt: "QC_REQUESTED" },
  // QC scheduled, inspector to visit
  { vendor: "v-goldenear", product: 2, qty: 5000, issuedDaysAgo: 43, leadDays: 40, late: 0, holdAt: "QC_SCHEDULED" },
  { vendor: "v-brightsound", product: 3, qty: 6400, issuedDaysAgo: 45, leadDays: 42, late: 1, holdAt: "QC_SCHEDULED" },
  // STORY: QC failed, in rework
  { vendor: "v-brightsound", product: 1, qty: 9000, issuedDaysAgo: 49, leadDays: 42, late: 2, qcFail: true, holdAt: "QC_FAILED" },
  // QC passed, vendor to create lot
  { vendor: "v-sonicwave", product: 4, qty: 3000, issuedDaysAgo: 50, leadDays: 44, late: -1, holdAt: "QC_PASSED" },
  // lot created, awaiting shipping details
  { vendor: "v-goldenear", product: 6, qty: 1200, issuedDaysAgo: 52, leadDays: 45, late: 0, holdAt: "CREATED" },
  // on the water
  { vendor: "v-sonicwave", product: 3, qty: 7200, issuedDaysAgo: 62, leadDays: 42, late: 0, transitDays: 20 },
  { vendor: "v-pearltone", product: 0, qty: 24000, issuedDaysAgo: 66, leadDays: 40, late: 3, transitDays: 21, etaSlipDays: 6, dischargePort: "Mundra" },
  // STORY: split shipment - one lot received, second still at sea
  { vendor: "v-goldenear", product: 1, qty: 14000, issuedDaysAgo: 84, leadDays: 40, late: 0, splitSecondLotAfter: 16, transitDays: 19 },
  // STORY: container stuck at Nhava Sheva
  { vendor: "v-harmony", product: 5, qty: 2800, issuedDaysAgo: 96, leadDays: 44, late: 8, transitDays: 18, customsDays: 30, holdAt: "AT_PORT", dischargePort: "Nhava Sheva (JNPT)" },
  // cleared, waiting for pickup
  { vendor: "v-sonicwave", product: 5, qty: 2000, issuedDaysAgo: 80, leadDays: 44, late: -1, transitDays: 18, holdAt: "CUSTOMS_CLEARED" },
  // picked up, warehouse to receive
  { vendor: "v-brightsound", product: 0, qty: 18000, issuedDaysAgo: 81, leadDays: 40, late: 1, qcFail: true, transitDays: 19, holdAt: "PICKED_UP" },
  // STORY: closed, invoice over-billed vs GRN - payment needs attention
  { vendor: "v-brightsound", product: 2, qty: 5000, issuedDaysAgo: 112, leadDays: 42, late: 0, transitDays: 18, invoiceQtyOver: 200 },
  // closed, balance falling due
  { vendor: "v-sonicwave", product: 6, qty: 1500, issuedDaysAgo: 122, leadDays: 45, late: 0, transitDays: 18 },
  { vendor: "v-pearltone", product: 2, qty: 4000, issuedDaysAgo: 124, leadDays: 42, late: 4, transitDays: 20 },
];

export async function seed(db: Db, now = new Date()) {
  const rand = mulberry32(20260115);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const between = (a: number, b: number) => a + Math.round(rand() * (b - a));
  const T = now.getTime();
  const at = (ms: number) => new Date(ms);

  const rows = {
    pos: [] as (typeof s.purchaseOrders.$inferInsert)[],
    inspections: [] as (typeof s.qcInspections.$inferInsert)[],
    lots: [] as (typeof s.lots.$inferInsert)[],
    docs: [] as (typeof s.documents.$inferInsert)[],
    grns: [] as (typeof s.goodsReceipts.$inferInsert)[],
    payments: [] as (typeof s.payments.$inferInsert)[],
    events: [] as (typeof s.events.$inferInsert)[],
  };

  let poSeq = 4500071200;
  let grnSeq = 5000312400;
  let evSeq = 0;
  let idSeq = 0;
  const nid = (p: string) => `${p}-${(++idSeq).toString(36).padStart(5, "0")}`;

  function play(spec: Spec) {
    const v = VENDORS.find((x) => x.id === spec.vendor)!;
    const p = PRODUCTS[spec.product];
    const poNumber = String(++poSeq);
    const poId = `po-${poNumber}`;
    const templateId = p.category === "speaker" ? "tpl-speaker" : "tpl-soundbar";
    const items = p.category === "speaker" ? SPEAKER_ITEMS : SOUNDBAR_ITEMS;

    // two colour lines per PO
    const c1 = pick(COLOURS);
    const c2 = COLOURS[(COLOURS.indexOf(c1) + 1) % COLOURS.length];
    const q1 = Math.round((spec.qty * 0.6) / p.perCarton) * p.perCarton;
    const q2 = spec.qty - q1;
    const lines = [
      { sku: `${p.sku}-${c1.slice(0, 3).toUpperCase()}`, description: `boAt ${p.name} - ${c1}`, qty: q1, unitPriceUsd: p.price },
      { sku: `${p.sku}-${c2.slice(0, 3).toUpperCase()}`, description: `boAt ${p.name} - ${c2}`, qty: q2, unitPriceUsd: p.price },
    ];
    const value = Math.round(spec.qty * p.price);

    const issued = T - spec.issuedDaysAgo * DAY;
    const po: typeof s.purchaseOrders.$inferInsert = {
      id: poId,
      poNumber,
      vendorId: v.id,
      category: p.category,
      productName: `boAt ${p.name}`,
      lines,
      totalQty: spec.qty,
      totalValueUsd: value,
      status: "ISSUED",
      issuedAt: at(issued),
      requestedLeadDays: spec.leadDays,
      productionPct: 0,
    };
    rows.pos.push(po);

    const ev = (t: number, type: string, role: string, name: string, message: string, lotId?: string) =>
      rows.events.push({ id: `ev-${++evSeq}`, poId, lotId: lotId ?? null, type, actorRole: role, actorName: name, message, at: at(t) });

    ev(issued, "PO_ISSUED", "system", "SAP", `PO ${poNumber} issued from SAP - ${spec.qty.toLocaleString("en-IN")} units of boAt ${p.name}`);
    if (spec.holdAt === "ISSUED") return;

    // --- vendor accepts and promises a lead time
    const accepted = issued + between(1, 2) * DAY;
    if (accepted > T) return;
    const promisedReady = accepted + spec.leadDays * DAY;
    po.status = "ACCEPTED";
    po.acceptedAt = at(accepted);
    po.promisedLeadDays = spec.leadDays;
    po.promisedReadyDate = at(promisedReady);
    ev(accepted, "PO_ACCEPTED", "vendor", v.contactName, `Accepted. Promised lead time ${spec.leadDays} days - ready by ${fmt(promisedReady)}`);

    if (v.advancePct > 0) {
      const due = accepted + 7 * DAY;
      const paidAt = accepted + 5 * DAY;
      rows.payments.push({
        id: nid("pay"), poId, vendorId: v.id, milestone: "advance",
        amountUsd: Math.round((value * v.advancePct) / 100), dueDate: at(due),
        status: paidAt <= T ? "paid" : "pending", paidAt: paidAt <= T ? at(paidAt) : null,
      });
      if (paidAt <= T) ev(paidAt, "PAYMENT_RELEASED", "finance", "Rupali Dewoolkar", `Advance of ${v.advancePct}% released`);
    }

    // --- production
    const late = spec.late ?? Math.round(v.lateMean + (rand() * 2 - 1) * v.lateSpread);
    const actualReady = promisedReady + late * DAY;
    const prodStart = accepted + 2 * DAY;
    if (prodStart > T) return;
    po.status = "IN_PRODUCTION";
    ev(prodStart, "PRODUCTION_STARTED", "vendor", v.contactName, "Production started - materials kitted");

    const qcRequested = actualReady - 4 * DAY;
    if (qcRequested > T) {
      const frac = (T - prodStart) / (qcRequested - prodStart);
      po.productionPct = Math.max(5, Math.min(95, Math.round(frac * 100)));
      // what the vendor *reports* can lag what the calendar says it should be
      if (spec.prodLag) {
        const planned = (T - prodStart) / (promisedReady - 4 * DAY - prodStart);
        po.productionPct = Math.max(5, Math.min(92, Math.round((planned - spec.prodLag) * 100)));
      }
      ev(T - 2 * DAY, "PRODUCTION_UPDATE", "vendor", v.contactName, `Production update - ${po.productionPct}% complete`);
      return;
    }
    po.productionPct = 100;

    // --- QC
    const failFirst = spec.qcFail ?? rand() < v.qcFailRate;
    const weak = v.weakItems[p.category];
    const sample = spec.qty > 10000 ? 315 : spec.qty > 3200 ? 200 : 125;
    const makeResults = (fail: boolean): ChecklistResult[] =>
      items.map((it) => {
        const bad = fail && weak.includes(it.id) && (it.id === weak[0] || rand() < 0.7);
        return bad
          ? { itemId: it.id, result: "fail", note: FAIL_NOTES[it.id] ?? "Does not meet spec on sampled units" }
          : { itemId: it.id, result: "pass" };
      });

    let attempt = 1;
    let reqAt = qcRequested;
    let passedAt = 0;
    po.status = "QC_REQUESTED";
    for (;;) {
      const insp: typeof s.qcInspections.$inferInsert = {
        id: nid("qc"), poId, templateId, attempt, status: "REQUESTED",
        requestedAt: at(reqAt), results: [], sampleSize: sample,
      };
      rows.inspections.push(insp);
      ev(reqAt, "QC_REQUESTED", "vendor", v.contactName, attempt === 1 ? "Goods ready - QC inspection requested" : "Rework complete - re-inspection requested");
      if (spec.holdAt === "QC_REQUESTED" && attempt === 1) return;

      const scheduledAt = reqAt + 1 * DAY;
      const visit = reqAt + 3 * DAY;
      if (scheduledAt > T) return;
      const inspector = pick(INSPECTORS);
      insp.status = "SCHEDULED";
      insp.scheduledFor = at(visit);
      insp.inspectorName = inspector;
      po.status = "QC_SCHEDULED";
      ev(scheduledAt, "QC_SCHEDULED", "procurement", "Gaurav Dwivedi", `QC scheduled for ${fmt(visit)} - inspector ${inspector}`);
      if (spec.holdAt === "QC_SCHEDULED" && attempt === 1) {
        insp.scheduledFor = at(Math.max(visit, T + DAY));
        return;
      }
      if (visit > T) return;

      const fail = failFirst && attempt === 1;
      insp.results = makeResults(fail);
      insp.completedAt = at(visit);
      if (fail) {
        const failed = insp.results.filter((r) => r.result === "fail").length;
        insp.status = "FAILED";
        insp.summary = `${failed} check${failed > 1 ? "s" : ""} failed on a sample of ${sample}. Rework required before re-inspection.`;
        po.status = "QC_FAILED";
        ev(visit, "QC_FAILED", "qc", inspector, `QC failed - ${failed} check${failed > 1 ? "s" : ""} failed. Rework required`);
        if (spec.holdAt === "QC_FAILED") return;
        reqAt = visit + 7 * DAY;
        if (reqAt > T) return;
        attempt++;
        po.status = "QC_REQUESTED";
        continue;
      }
      insp.status = "PASSED";
      insp.summary = `All checks passed on a sample of ${sample}.`;
      passedAt = visit;
      po.status = "QC_PASSED";
      po.qcPassedAt = at(visit);
      ev(visit, "QC_PASSED", "qc", inspector, `QC passed on a sample of ${sample} units`);
      break;
    }
    if (spec.holdAt === "QC_PASSED") return;

    // --- lots and shipping
    const lotQtys = spec.splitSecondLotAfter ? [Math.round(spec.qty * 0.55), spec.qty - Math.round(spec.qty * 0.55)] : [spec.qty];
    const discharge = spec.dischargePort ?? pick(DISCHARGE_PORTS);
    let received = 0;
    let lastReceived = 0;

    lotQtys.forEach((qty, i) => {
      const created = passedAt + 1 * DAY + (i === 1 ? spec.splitSecondLotAfter! * DAY : 0);
      if (created > T) return;
      const lotNumber = `LOT-${poNumber.slice(-5)}-${String(i + 1).padStart(2, "0")}`;
      const lotId = `lot-${poNumber}-${i + 1}`;
      const lot: typeof s.lots.$inferInsert = {
        id: lotId, lotNumber, poId, qty, cartons: Math.ceil(qty / p.perCarton), status: "CREATED", createdAt: at(created),
      };
      rows.lots.push(lot);
      po.status = "IN_TRANSIT";
      ev(created, "LOT_CREATED", "vendor", v.contactName, `Lot ${lotNumber} created - ${qty.toLocaleString("en-IN")} units in ${lot.cartons} cartons`, lotId);
      if (spec.holdAt === "CREATED") return;

      const shipped = created + 3 * DAY;
      if (shipped > T) return;
      const line = pick(CARRIERS);
      const transit = spec.transitDays ?? between(17, 22);
      const slip = i === 0 || !spec.splitSecondLotAfter ? spec.etaSlipDays ?? 0 : 0;
      const originalEta = shipped + transit * DAY;
      const eta = originalEta + slip * DAY;
      const serial = `${line.prefix}${between(100000, 999999)}`;
      Object.assign(lot, {
        status: "SHIPPED", containerNo: `${serial}${containerCheckDigit(serial)}`,
        blNo: `${line.carrier.slice(0, 3).toUpperCase()}SZX${between(100000, 999999)}`,
        carrier: line.carrier, vessel: pick(line.vessels), portOfLoading: v.port, portOfDischarge: discharge,
        etd: at(shipped), originalEta: at(originalEta), eta: at(eta), shippedAt: at(shipped),
      });
      ev(shipped, "LOT_SHIPPED", "vendor", v.contactName, `Shipped in container ${lot.containerNo} on ${lot.vessel} from ${v.port}. ETA ${discharge} ${fmt(originalEta)}`, lotId);
      if (slip && shipped + 8 * DAY <= T) ev(shipped + 8 * DAY, "ETA_CHANGED", "system", "Carrier feed", `ETA revised by ${slip} days to ${fmt(eta)} - transshipment delay`, lotId);

      // shipping documents, read and matched against the PO
      const billedQty = qty + (spec.invoiceQtyOver ?? 0);
      const docBase = { poId, lotId, uploadedBy: v.contactName, createdAt: at(shipped) };
      rows.docs.push(
        { ...docBase, id: nid("doc"), type: "packing_list", fileName: `PL-${lotNumber}.pdf`, matchStatus: "match", issues: [],
          extracted: { poNumber, lotNumber, totalUnits: qty, totalCartons: lot.cartons, containerNo: lot.containerNo } },
        { ...docBase, id: nid("doc"), type: "bill_of_lading", fileName: `BL-${lot.blNo}.pdf`, matchStatus: "match", issues: [],
          extracted: { blNumber: lot.blNo, containerNo: lot.containerNo, vessel: lot.vessel, portOfLoading: v.port, portOfDischarge: discharge, cartons: lot.cartons } },
        { ...docBase, id: nid("doc"), type: "invoice", fileName: `INV-${lotNumber}.pdf`,
          matchStatus: spec.invoiceQtyOver ? "mismatch" : "match",
          issues: spec.invoiceQtyOver
            ? [
                { field: "Quantity", expected: `${qty.toLocaleString("en-IN")} units (lot ${lotNumber})`, found: `${billedQty.toLocaleString("en-IN")} units` },
                { field: "Invoice value", expected: `USD ${Math.round(qty * p.price).toLocaleString("en-US")}`, found: `USD ${Math.round(billedQty * p.price).toLocaleString("en-US")}` },
              ]
            : [],
          extracted: { invoiceNumber: `INV-${poNumber.slice(-5)}-${i + 1}`, poNumber, quantity: billedQty, unitPriceUsd: p.price, totalUsd: Math.round(billedQty * p.price), currency: "USD" } },
      );
      if (spec.invoiceQtyOver) ev(shipped, "DOC_MISMATCH", "system", "Document AI", `Invoice bills ${billedQty.toLocaleString("en-IN")} units against a lot of ${qty.toLocaleString("en-IN")}`, lotId);

      if (eta > T) return;
      lot.status = "AT_PORT";
      lot.arrivedAt = at(eta);
      ev(eta, "ARRIVED_PORT", "logistics", "Vikram Desai", `Container ${lot.containerNo} discharged at ${discharge}`, lotId);
      if (spec.holdAt === "AT_PORT") return;

      const cleared = eta + (spec.customsDays ?? between(2, 4)) * DAY;
      if (cleared > T) return;
      lot.status = "CUSTOMS_CLEARED";
      lot.clearedAt = at(cleared);
      ev(cleared, "CUSTOMS_CLEARED", "logistics", "Vikram Desai", "Customs cleared - bill of entry filed, duty paid", lotId);
      if (spec.holdAt === "CUSTOMS_CLEARED") return;

      const picked = cleared + 1 * DAY;
      if (picked > T) return;
      lot.status = "PICKED_UP";
      lot.pickedUpAt = at(picked);
      ev(picked, "PICKED_UP", "logistics", "Vikram Desai", "Container picked up - in transit to Bhiwandi warehouse", lotId);
      if (spec.holdAt === "PICKED_UP") return;

      const recv = picked + 2 * DAY;
      if (recv > T) return;
      const damaged = rand() < 0.2 ? between(4, 30) : 0;
      lot.status = "RECEIVED";
      lot.receivedAt = at(recv);
      const grnNumber = String(++grnSeq);
      rows.grns.push({ id: nid("grn"), grnNumber, lotId, poId, receivedQty: qty - damaged, damagedQty: damaged, shortQty: 0, note: damaged ? "Carton damage in transit" : null, postedAt: at(recv) });
      ev(recv, "GRN_POSTED", "warehouse", "Suresh Patil", `Received ${(qty - damaged).toLocaleString("en-IN")} units${damaged ? `, ${damaged} damaged` : ""}. GRN ${grnNumber} posted to SAP`, lotId);
      received += qty;
      lastReceived = Math.max(lastReceived, recv);
    });

    // --- close and pay
    if (received < spec.qty) return;
    po.status = "CLOSED";
    po.closedAt = at(lastReceived);
    ev(lastReceived, "PO_CLOSED", "system", "SAP", `All lots received - PO ${poNumber} closed in SAP`);
    const balance = Math.round(value * (1 - v.advancePct / 100));
    const due = lastReceived + v.creditDays * DAY;
    const autoPaid = due < T - 3 * DAY && !spec.invoiceQtyOver;
    rows.payments.push({
      id: nid("pay"), poId, vendorId: v.id, milestone: "balance", amountUsd: balance, dueDate: at(due),
      status: spec.invoiceQtyOver ? "on_hold" : autoPaid ? "paid" : "pending",
      holdReason: spec.invoiceQtyOver ? "Invoice quantity does not match GRN" : null,
      paidAt: autoPaid ? at(due) : null,
    });
    if (autoPaid) {
      po.status = "PAID";
      ev(due, "PAYMENT_RELEASED", "finance", "Rupali Dewoolkar", `Balance payment released - ${v.creditDays} days after GRN per terms`);
    }
  }

  // 12 months of history
  const history: Spec[] = [];
  for (let i = 0; i < 46; i++) {
    const v = VENDORS[i % VENDORS.length];
    history.push({
      vendor: v.id,
      product: Math.floor(rand() * PRODUCTS.length),
      qty: between(3, 40) * 500,
      issuedDaysAgo: between(175, 365),
      leadDays: between(38, 46),
    });
  }
  history.sort((a, b) => b.issuedDaysAgo - a.issuedDaysAgo).forEach(play);
  [...ACTIVE].sort((a, b) => b.issuedDaysAgo - a.issuedDaysAgo).forEach(play);

  await db.transaction(async (tx) => {
    await tx.execute(sql`truncate table events, payments, goods_receipts, documents, lots, qc_inspections, qc_templates, purchase_orders, vendors cascade`);
    await tx.insert(s.vendors).values(
      VENDORS.map((v, i) => ({ id: v.id, name: v.name, city: v.city, contactName: v.contactName, advancePct: v.advancePct, creditDays: v.creditDays, onboardedAt: at(T - (500 + i * 90) * DAY) })),
    );
    await tx.insert(s.qcTemplates).values([
      { id: "tpl-speaker", category: "speaker", name: "Portable speakers - pre-shipment inspection", items: SPEAKER_ITEMS, approved: true, updatedAt: at(T - 200 * DAY) },
      { id: "tpl-soundbar", category: "soundbar", name: "Soundbars - pre-shipment inspection", items: SOUNDBAR_ITEMS, approved: true, updatedAt: at(T - 200 * DAY) },
    ]);
    const chunked = async <R,>(table: Parameters<typeof tx.insert>[0], data: R[]) => {
      for (let i = 0; i < data.length; i += 200) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.insert(table).values(data.slice(i, i + 200) as any);
      }
    };
    await chunked(s.purchaseOrders, rows.pos);
    await chunked(s.qcInspections, rows.inspections);
    await chunked(s.lots, rows.lots);
    await chunked(s.documents, rows.docs);
    await chunked(s.goodsReceipts, rows.grns);
    await chunked(s.payments, rows.payments);
    await chunked(s.events, rows.events);
  });

  return { pos: rows.pos.length, lots: rows.lots.length, events: rows.events.length };
}

const FAIL_NOTES: Record<string, string> = {
  s1: "Gross weight missing on 6 of 20 cartons checked",
  s2: "MRP label missing on 3 of 10 gift boxes",
  s4: "Scuff marks on grille, 5 units",
  s5: "Logo lifts on tape test, 2 units",
  s7: "Pairing takes 9-12 s on 4 units; drops at 7 m",
  s10: "Audible buzz at 120 Hz on 6 units",
  s11: "Playtime 9.5 h against 12 h spec on 2 of 3 units",
  s12: "No charge cut-off at 100% on 3 units",
  s13: "Gift box corner crush after drop, 2 units",
  b1: "PO number missing on carton side panel",
  b2: "BIS mark missing on power adaptor, 4 units",
  b4: "Loose fabric thread on grille, 3 units",
  b7: "Subwoofer failed to auto-pair on 3 units",
  b8: "Volume key unresponsive on 2 remotes",
  b10: "Port noise at high volume, 4 units",
  b13: "Thermal shutdown at 2h40 on 1 of 5 units",
  b14: "Corner foam cracked after drop sequence",
};

function fmt(ms: number) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

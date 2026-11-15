import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** PO-level stage. Once lots exist, per-lot progress lives on `lots.status`. */
export const PO_STATUSES = [
  "ISSUED",
  "ACCEPTED",
  "IN_PRODUCTION",
  "QC_REQUESTED",
  "QC_SCHEDULED",
  "QC_FAILED",
  "QC_PASSED",
  "IN_TRANSIT",
  "CLOSED",
  "PAID",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const LOT_STATUSES = [
  "CREATED",
  "SHIPPED",
  "AT_PORT",
  "CUSTOMS_CLEARED",
  "PICKED_UP",
  "RECEIVED",
] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export type Category = "speaker" | "soundbar";

export type ChecklistItem = {
  id: string;
  section: string;
  check: string;
  method: string;
  critical: boolean;
};

export type ChecklistResult = {
  itemId: string;
  result: "pass" | "fail" | "na";
  note?: string;
  photoUrl?: string;
};

export type PoLine = {
  sku: string;
  description: string;
  qty: number;
  unitPriceUsd: number;
};

export type MatchIssue = { field: string; expected: string; found: string };

export const vendors = pgTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  contactName: text("contact_name").notNull(),
  advancePct: integer("advance_pct").notNull(),
  creditDays: integer("credit_days").notNull(),
  onboardedAt: ts("onboarded_at").notNull(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: text("id").primaryKey(),
  poNumber: text("po_number").notNull().unique(),
  vendorId: text("vendor_id")
    .notNull()
    .references(() => vendors.id),
  category: text("category").$type<Category>().notNull(),
  productName: text("product_name").notNull(),
  lines: jsonb("lines").$type<PoLine[]>().notNull(),
  totalQty: integer("total_qty").notNull(),
  totalValueUsd: real("total_value_usd").notNull(),
  status: text("status").$type<PoStatus>().notNull(),
  issuedAt: ts("issued_at").notNull(),
  requestedLeadDays: integer("requested_lead_days").notNull(),
  acceptedAt: ts("accepted_at"),
  promisedLeadDays: integer("promised_lead_days"),
  promisedReadyDate: ts("promised_ready_date"),
  productionPct: integer("production_pct").notNull().default(0),
  qcPassedAt: ts("qc_passed_at"),
  closedAt: ts("closed_at"),
});

export const qcTemplates = pgTable("qc_templates", {
  id: text("id").primaryKey(),
  category: text("category").$type<Category>().notNull(),
  name: text("name").notNull(),
  items: jsonb("items").$type<ChecklistItem[]>().notNull(),
  approved: boolean("approved").notNull().default(false),
  aiDrafted: boolean("ai_drafted").notNull().default(false),
  updatedAt: ts("updated_at").notNull(),
});

export const qcInspections = pgTable("qc_inspections", {
  id: text("id").primaryKey(),
  poId: text("po_id")
    .notNull()
    .references(() => purchaseOrders.id),
  templateId: text("template_id")
    .notNull()
    .references(() => qcTemplates.id),
  attempt: integer("attempt").notNull().default(1),
  status: text("status").$type<"REQUESTED" | "SCHEDULED" | "PASSED" | "FAILED">().notNull(),
  requestedAt: ts("requested_at").notNull(),
  scheduledFor: ts("scheduled_for"),
  inspectorName: text("inspector_name"),
  sampleSize: integer("sample_size"),
  results: jsonb("results").$type<ChecklistResult[]>().notNull().default([]),
  summary: text("summary"),
  completedAt: ts("completed_at"),
});

/** A lot = one QC-passed batch of a PO shipped in one container. */
export const lots = pgTable("lots", {
  id: text("id").primaryKey(),
  lotNumber: text("lot_number").notNull().unique(),
  poId: text("po_id")
    .notNull()
    .references(() => purchaseOrders.id),
  qty: integer("qty").notNull(),
  cartons: integer("cartons").notNull(),
  status: text("status").$type<LotStatus>().notNull(),
  createdAt: ts("created_at").notNull(),
  containerNo: text("container_no"),
  blNo: text("bl_no"),
  carrier: text("carrier"),
  vessel: text("vessel"),
  portOfLoading: text("port_of_loading"),
  portOfDischarge: text("port_of_discharge"),
  etd: ts("etd"),
  originalEta: ts("original_eta"),
  eta: ts("eta"),
  shippedAt: ts("shipped_at"),
  arrivedAt: ts("arrived_at"),
  clearedAt: ts("cleared_at"),
  pickedUpAt: ts("picked_up_at"),
  receivedAt: ts("received_at"),
});

export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  poId: text("po_id")
    .notNull()
    .references(() => purchaseOrders.id),
  lotId: text("lot_id").references(() => lots.id),
  type: text("type").$type<"packing_list" | "bill_of_lading" | "invoice" | "other">().notNull(),
  fileName: text("file_name").notNull(),
  storagePath: text("storage_path"),
  extracted: jsonb("extracted").$type<Record<string, unknown>>().notNull(),
  matchStatus: text("match_status").$type<"match" | "mismatch">().notNull(),
  issues: jsonb("issues").$type<MatchIssue[]>().notNull().default([]),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const goodsReceipts = pgTable("goods_receipts", {
  id: text("id").primaryKey(),
  grnNumber: text("grn_number").notNull().unique(),
  lotId: text("lot_id")
    .notNull()
    .references(() => lots.id),
  poId: text("po_id")
    .notNull()
    .references(() => purchaseOrders.id),
  receivedQty: integer("received_qty").notNull(),
  damagedQty: integer("damaged_qty").notNull().default(0),
  shortQty: integer("short_qty").notNull().default(0),
  note: text("note"),
  postedAt: ts("posted_at").notNull(),
});

export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  poId: text("po_id")
    .notNull()
    .references(() => purchaseOrders.id),
  vendorId: text("vendor_id")
    .notNull()
    .references(() => vendors.id),
  milestone: text("milestone").$type<"advance" | "balance">().notNull(),
  amountUsd: real("amount_usd").notNull(),
  dueDate: ts("due_date").notNull(),
  status: text("status").$type<"pending" | "paid" | "on_hold">().notNull(),
  holdReason: text("hold_reason"),
  paidAt: ts("paid_at"),
});

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  poId: text("po_id")
    .notNull()
    .references(() => purchaseOrders.id),
  lotId: text("lot_id"),
  type: text("type").notNull(),
  actorRole: text("actor_role").notNull(),
  actorName: text("actor_name").notNull(),
  message: text("message").notNull(),
  at: ts("at").notNull(),
});

export type Vendor = typeof vendors.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type QcTemplate = typeof qcTemplates.$inferSelect;
export type QcInspection = typeof qcInspections.$inferSelect;
export type Lot = typeof lots.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type GoodsReceipt = typeof goodsReceipts.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type EventRow = typeof events.$inferSelect;

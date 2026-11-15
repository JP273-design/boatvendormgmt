import type { LotStatus, PoStatus } from "@/db/schema";

export const DAY = 86_400_000;
const TZ = "Asia/Kolkata";

export function fmtDate(d: Date | null | undefined, withYear = false) {
  if (!d) return "-";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: TZ,
  });
}

export function fmtDateTime(d: Date | null | undefined) {
  if (!d) return "-";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

/** yyyy-mm-dd for <input type="date"> */
export function isoDate(d: Date) {
  return new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / DAY);
}

export function relDays(d: Date, now = new Date()) {
  const n = daysBetween(now, d);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function usd(n: number, compact = false) {
  if (compact) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  }
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export const num = (n: number) => n.toLocaleString("en-IN");
export const pct = (n: number | null) => (n === null ? "-" : `${Math.round(n)}%`);

export const PO_STAGE_LABEL: Record<PoStatus, string> = {
  ISSUED: "Awaiting vendor",
  ACCEPTED: "Accepted",
  IN_PRODUCTION: "In production",
  QC_REQUESTED: "QC requested",
  QC_SCHEDULED: "QC scheduled",
  QC_FAILED: "QC failed - rework",
  QC_PASSED: "QC passed",
  IN_TRANSIT: "Shipping",
  CLOSED: "Closed - payment due",
  PAID: "Paid",
};

export const LOT_STAGE_LABEL: Record<LotStatus, string> = {
  CREATED: "Lot created",
  SHIPPED: "On the water",
  AT_PORT: "At India port",
  CUSTOMS_CLEARED: "Customs cleared",
  PICKED_UP: "In transit to warehouse",
  RECEIVED: "Received",
};

/** The 8 milestones shown on every PO progress bar. */
export const MILESTONES = ["PO issued", "Accepted", "Production", "QC", "Shipped", "At port", "Received", "Paid"] as const;

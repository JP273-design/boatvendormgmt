import type { PoView } from "./data";
import type { Persona } from "./personas";

/** The one thing this persona should do next on this PO, if anything. Drives "Needs you" chips. */
export function nextAction(v: PoView, p: Persona, now: Date): string | null {
  const s = v.po.status;
  switch (p.role) {
    case "vendor":
      if (v.vendor.id !== p.vendorId) return null;
      if (s === "ISSUED") return "Accept and confirm lead time";
      if (s === "ACCEPTED") return "Start production";
      if (s === "IN_PRODUCTION") return v.po.productionPct >= 90 ? "Request QC" : "Update production";
      if (s === "QC_FAILED") return "Rework and re-request QC";
      if (s === "QC_PASSED") return "Create lot";
      if (s === "IN_TRANSIT") {
        if (v.lots.some((l) => l.status === "CREATED")) return "Add shipping details";
        if (v.lots.reduce((a, l) => a + l.qty, 0) < v.po.totalQty) return "Create lot for remaining qty";
      }
      return null;
    case "procurement":
      if (s === "QC_REQUESTED") return "Schedule QC";
      return null;
    case "qc":
      if (s === "QC_SCHEDULED") return "Inspect";
      return null;
    case "logistics":
      if (s !== "IN_TRANSIT") return null;
      if (v.lots.some((l) => l.status === "AT_PORT")) return "Clear customs";
      if (v.lots.some((l) => l.status === "CUSTOMS_CLEARED")) return "Book pickup";
      if (v.lots.some((l) => l.status === "SHIPPED" && l.eta && l.eta <= now)) return "Confirm arrival";
      return null;
    case "warehouse":
      if (v.lots.some((l) => l.status === "PICKED_UP")) return "Receive and post GRN";
      return null;
    case "finance": {
      const open = v.payments.filter((x) => x.status !== "paid");
      if (open.some((x) => x.status === "on_hold")) return "Resolve payment hold";
      if (open.some((x) => x.dueDate.getTime() - now.getTime() < 7 * 86_400_000)) return "Release payment";
      return null;
    }
    default:
      return null;
  }
}

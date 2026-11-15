import type { Category, PoLine } from "@/db/schema";

/**
 * The only door between this app and SAP. The demo uses MockSap; the pilot
 * swaps in a CSV or OData implementation without touching the workflow.
 */
export type SapPurchaseOrder = {
  poNumber: string;
  vendorId: string;
  category: Category;
  productName: string;
  lines: PoLine[];
  requestedLeadDays: number;
  issuedAt: Date;
};

export interface SapAdapter {
  /** Pull POs released in SAP since the last sync. */
  fetchNewPurchaseOrders(): Promise<SapPurchaseOrder[]>;
  /** MIGO goods receipt against a PO. Returns the material document (GRN) number. */
  postGoodsReceipt(input: { poNumber: string; lotNumber: string; receivedQty: number; damagedQty: number }): Promise<{ grnNumber: string }>;
  /** Set the delivery-completed indicator on the PO. */
  closePurchaseOrder(poNumber: string): Promise<void>;
}

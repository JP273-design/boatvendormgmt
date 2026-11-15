import "server-only";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Category } from "@/db/schema";
import type { SapAdapter, SapPurchaseOrder } from "./adapter";

const CATALOG: { name: string; sku: string; category: Category; price: number; perCarton: number }[] = [
  { name: "Stone 650", sku: "SPK-ST650", category: "speaker", price: 13.2, perCarton: 24 },
  { name: "Stone 1200F", sku: "SPK-ST1200F", category: "speaker", price: 24.5, perCarton: 12 },
  { name: "Stone Spinx 2.0", sku: "SPK-SPINX2", category: "speaker", price: 18.9, perCarton: 16 },
  { name: "Aavante Bar 1160", sku: "SBR-AV1160", category: "soundbar", price: 27.8, perCarton: 6 },
  { name: "Aavante Bar 1500", sku: "SBR-AV1500", category: "soundbar", price: 41.5, perCarton: 4 },
];

/** Stands in for SAP. Numbers follow SAP conventions (45… PO, 50… material document). */
export class MockSap implements SapAdapter {
  async fetchNewPurchaseOrders(): Promise<SapPurchaseOrder[]> {
    const [{ max }] = await db.select({ max: sql<string>`max(${schema.purchaseOrders.poNumber})` }).from(schema.purchaseOrders);
    const vendors = await db.select().from(schema.vendors);
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    const p = pick(CATALOG);
    const qty = (4 + Math.floor(Math.random() * 20)) * 500;
    const q1 = Math.round((qty * 0.6) / p.perCarton) * p.perCarton;
    return [
      {
        poNumber: String(Number(max ?? "4500071200") + 1),
        vendorId: pick(vendors).id,
        category: p.category,
        productName: `boAt ${p.name}`,
        lines: [
          { sku: `${p.sku}-BLA`, description: `boAt ${p.name} - Black`, qty: q1, unitPriceUsd: p.price },
          { sku: `${p.sku}-BLU`, description: `boAt ${p.name} - Blue`, qty: qty - q1, unitPriceUsd: p.price },
        ],
        requestedLeadDays: 40 + Math.floor(Math.random() * 6),
        issuedAt: new Date(),
      },
    ];
  }

  async postGoodsReceipt() {
    const [{ max }] = await db.select({ max: sql<string>`max(${schema.goodsReceipts.grnNumber})` }).from(schema.goodsReceipts);
    return { grnNumber: String(Number(max ?? "5000312400") + 1) };
  }

  async closePurchaseOrder() {
    // SAP sets the delivery-completed flag; nothing to do in the mock.
  }
}

export const sap: SapAdapter = new MockSap();

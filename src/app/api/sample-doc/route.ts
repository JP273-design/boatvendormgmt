import { getSnapshot, scopeViews } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { textPdf } from "@/lib/pdf";
import { getPersona } from "@/lib/session";

/**
 * Demo helper: builds a realistic packing list, bill of lading or invoice PDF for a
 * live lot, so there is always a document to upload. `?error=1` plants a quantity
 * mistake for the document reader to catch.
 */
export async function GET(req: Request) {
  const persona = await getPersona();
  if (!persona) return new Response("Not signed in", { status: 401 });
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "invoice";
  const wrong = url.searchParams.get("error") === "1";
  const snap = await getSnapshot();
  const v = scopeViews(snap, persona).find((x) => x.lots.some((l) => l.id === url.searchParams.get("lot")));
  const lot = v?.lots.find((l) => l.id === url.searchParams.get("lot"));
  if (!v || !lot) return new Response("Lot not found", { status: 404 });

  const { po, vendor } = v;
  const price = po.lines[0].unitPriceUsd;
  const qty = lot.qty + (wrong ? Math.max(100, Math.round(lot.qty * 0.04)) : 0);
  const n = (x: number) => x.toLocaleString("en-US");
  const head = (title: string) => [
    { text: vendor.name.toUpperCase(), size: 14, bold: true },
    { text: `${vendor.city}, Guangdong, China`, size: 9 },
    { text: title, size: 16, bold: true, gap: 18 },
    { text: `Date: ${fmtDate(lot.shippedAt ?? snap.now, true)}`, gap: 6 },
    { text: "Buyer: Imagine Marketing Ltd (boAt), Mumbai, India" },
  ];
  const row = (a: string, b: string) => ({ text: `${a.padEnd(26)}${b}` });

  let lines;
  let name;
  if (type === "packing_list") {
    name = `PL-${lot.lotNumber}`;
    lines = [
      ...head("PACKING LIST"),
      { ...row("Buyer PO No.:", po.poNumber), gap: 14 },
      row("Lot No.:", lot.lotNumber),
      row("Container No.:", lot.containerNo ?? "TBA"),
      { text: "DESCRIPTION                     CARTONS      UNITS", bold: true, gap: 14 },
      { text: `${po.productName.padEnd(32)}${n(lot.cartons).padEnd(13)}${n(qty)}` },
      { ...row("TOTAL CARTONS:", n(lot.cartons)), gap: 14, bold: true },
      { ...row("TOTAL UNITS (PCS):", n(qty)), bold: true },
      row("Gross weight (kg):", n(Math.round(lot.cartons * 11.4))),
    ];
  } else if (type === "bill_of_lading") {
    name = `BL-${lot.blNo ?? lot.lotNumber}`;
    lines = [
      { text: (lot.carrier ?? "CARRIER").toUpperCase(), size: 14, bold: true },
      { text: "BILL OF LADING", size: 16, bold: true, gap: 18 },
      { ...row("B/L No.:", lot.blNo ?? "-"), gap: 10 },
      row("Shipper:", vendor.name),
      row("Consignee:", "Imagine Marketing Ltd (boAt)"),
      row("Vessel:", lot.vessel ?? "-"),
      row("Port of loading:", `${lot.portOfLoading ?? "-"}, China`),
      row("Port of discharge:", lot.portOfDischarge ?? "-"),
      { ...row("Container No.:", lot.containerNo ?? "-"), gap: 10 },
      row("No. of packages:", `${n(lot.cartons)} CARTONS`),
      row("Description:", `${po.productName} - audio equipment`),
      row("Gross weight (kg):", n(Math.round(lot.cartons * 11.4))),
      { text: "SHIPPED ON BOARD", bold: true, gap: 14 },
    ];
  } else {
    name = `INV-${lot.lotNumber}${wrong ? "-overbilled" : ""}`;
    lines = [
      ...head("COMMERCIAL INVOICE"),
      { ...row("Invoice No.:", `INV-${lot.lotNumber.slice(4)}`), gap: 14 },
      row("Buyer PO No.:", po.poNumber),
      row("Lot No.:", lot.lotNumber),
      { text: "DESCRIPTION                     QTY        UNIT USD     AMOUNT USD", bold: true, gap: 14 },
      { text: `${po.productName.padEnd(32)}${n(qty).padEnd(11)}${price.toFixed(2).padEnd(13)}${n(Math.round(qty * price))}` },
      { ...row("TOTAL QUANTITY:", `${n(qty)} PCS`), gap: 14, bold: true },
      { ...row("TOTAL AMOUNT:", `USD ${n(Math.round(qty * price))}`), bold: true },
      { ...row("Payment terms:", `${vendor.advancePct}% advance, balance ${vendor.creditDays} days after GRN`), gap: 10 },
      row("Incoterm:", `FOB ${lot.portOfLoading ?? "Shenzhen"}`),
    ];
  }

  return new Response(new Uint8Array(textPdf(lines)), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "Cache-Control": "no-store" },
  });
}

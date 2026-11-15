import { ReceiveForm } from "@/components/lot-forms";
import { Card, Empty, PageHeader, PoLink, TableWrap } from "@/components/ui";
import { getSnapshot } from "@/lib/data";
import { fmtDate, num, relDays } from "@/lib/format";
import { requirePersona } from "@/lib/session";

export default async function WarehousePage() {
  const persona = await requirePersona();
  if (persona.role === "vendor") return <Empty>Not available for vendors.</Empty>;
  const snap = await getSnapshot();
  const lots = snap.views.flatMap((v) => v.lots.map((l) => ({ l, v })));
  const toReceive = lots.filter((x) => x.l.status === "PICKED_UP");
  const inbound = lots.filter((x) => ["AT_PORT", "CUSTOMS_CLEARED"].includes(x.l.status) || (x.l.status === "SHIPPED" && x.l.eta && x.l.eta.getTime() - snap.now.getTime() < 10 * 86_400_000));
  const recent = snap.views
    .flatMap((v) => v.grns.map((g) => ({ g, v, l: v.lots.find((l) => l.id === g.lotId) })))
    .sort((a, b) => b.g.postedAt.getTime() - a.g.postedAt.getTime())
    .slice(0, 10);

  return (
    <>
      <PageHeader title="Receiving" subtitle="Count the lot, post the goods receipt to SAP. The PO closes when its last lot is in." />
      <Card title={`At the dock · ${toReceive.length}`} className="mb-4">
        {toReceive.length === 0 ? <Empty>No trucks waiting. Inbound lots are listed below.</Empty> : (
          <div className="space-y-5 divide-y divide-line [&>*:not(:first-child)]:pt-5">
            {toReceive.map(({ l, v }) => (
              <div key={l.id}>
                <div className="mb-2 text-sm font-medium">{v.po.productName} <span className="font-normal text-muted">· {v.vendor.name} · <PoLink id={v.po.id} number={v.po.poNumber} /></span></div>
                {persona.role === "warehouse" ? <ReceiveForm lot={l} /> : <p className="text-xs text-muted">{l.lotNumber} · {num(l.qty)} units · picked up {l.pickedUpAt ? relDays(l.pickedUpAt, snap.now) : ""} · warehouse posts the GRN</p>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Inbound - next 10 days" pad={false}>
          {inbound.length === 0 ? <div className="p-4"><Empty>Nothing inbound.</Empty></div> : (
            <ul className="divide-y divide-line">
              {inbound.map(({ l, v }) => (
                <li key={l.id} className="px-4 py-2.5 text-sm">
                  <div className="flex justify-between gap-3"><span className="font-medium">{v.po.productName}</span><span className="tnum text-muted">{num(l.qty)} units · {num(l.cartons)} ctns</span></div>
                  <div className="text-xs text-muted">{l.lotNumber} · {l.containerNo} · {l.status === "SHIPPED" ? `ETA ${l.portOfDischarge} ${fmtDate(l.eta)}` : l.status === "AT_PORT" ? `At ${l.portOfDischarge}, in customs` : "Cleared, awaiting pickup"}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent goods receipts" pad={false}>
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-line bg-slate-50/60"><tr><th className="th">GRN</th><th className="th">Lot</th><th className="th text-right">Received</th><th className="th text-right">Damaged</th><th className="th">Posted</th></tr></thead>
              <tbody className="divide-y divide-line">
                {recent.map(({ g, l }) => (
                  <tr key={g.id}>
                    <td className="td font-mono text-xs">{g.grnNumber}</td>
                    <td className="td font-mono text-xs">{l?.lotNumber}</td>
                    <td className="td tnum text-right">{num(g.receivedQty)}</td>
                    <td className="td tnum text-right">{g.damagedQty ? <span className="text-red-600">{num(g.damagedQty)}</span> : "-"}</td>
                    <td className="td whitespace-nowrap text-xs text-muted">{fmtDate(g.postedAt, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      </div>
    </>
  );
}

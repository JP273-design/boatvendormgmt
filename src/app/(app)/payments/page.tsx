import { ActionForm } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader, PoLink, Stat, TableWrap } from "@/components/ui";
import { getSnapshot, scopeViews } from "@/lib/data";
import { DAY, fmtDate, num, relDays, usd } from "@/lib/format";
import { requirePersona } from "@/lib/session";
import { releasePayment, setPaymentHold } from "../../actions";

export default async function PaymentsPage() {
  const persona = await requirePersona();
  const snap = await getSnapshot();
  const now = snap.now.getTime();
  const all = scopeViews(snap, persona).flatMap((v) => v.payments.map((p) => ({ p, v })));
  const open = all.filter((x) => x.p.status !== "paid").sort((a, b) => a.p.dueDate.getTime() - b.p.dueDate.getTime());
  const paid = all.filter((x) => x.p.status === "paid").sort((a, b) => b.p.paidAt!.getTime() - a.p.paidAt!.getTime()).slice(0, 10);
  const sum = (list: typeof all) => list.reduce((a, x) => a + x.p.amountUsd, 0);
  const due = (days: number) => open.filter((x) => x.p.status === "pending" && x.p.dueDate.getTime() - now <= days * DAY);
  const held = open.filter((x) => x.p.status === "on_hold");
  const isFinance = persona.role === "finance";
  const isVendor = persona.role === "vendor";

  return (
    <>
      <PageHeader title={isVendor ? "My payments" : "Payments"} subtitle={isVendor ? "What boAt owes you and when it falls due" : "Released against agreed terms once the PO is closed in SAP"} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={isVendor ? "Receivable" : "Total payable"} value={usd(sum(open), true)} sub={`${open.length} payments open`} />
        <Stat label="Due within 7 days" value={usd(sum(due(7)), true)} tone={due(7).length ? "amber" : undefined} sub={`${due(7).length} payments`} />
        <Stat label="Due within 30 days" value={usd(sum(due(30)), true)} sub={`${due(30).length} payments`} />
        <Stat label="On hold" value={usd(sum(held), true)} tone={held.length ? "red" : undefined} sub={held.length ? `${held.length} need resolution` : "none"} />
      </div>

      <Card title="Open payments" pad={false} className="mb-4">
        {open.length === 0 ? <div className="p-4"><Empty>Nothing outstanding.</Empty></div> : (
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-line bg-slate-50/60">
                <tr><th className="th">PO</th>{!isVendor && <th className="th">Vendor</th>}<th className="th">Milestone</th><th className="th text-right">Amount</th><th className="th">Due</th><th className="th">3-way match</th><th className="th">Status</th>{isFinance && <th className="th" />}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {open.map(({ p, v }) => {
                  const invoice = v.docs.filter((d) => d.type === "invoice");
                  const grnQty = v.grns.reduce((a, g) => a + g.receivedQty, 0);
                  const lost = v.grns.reduce((a, g) => a + g.damagedQty + g.shortQty, 0);
                  const invoiceOk = invoice.length > 0 && invoice.every((d) => d.matchStatus === "match");
                  const overdue = p.dueDate.getTime() < now;
                  return (
                    <tr key={p.id} className={p.status === "on_hold" ? "bg-red-50/40" : undefined}>
                      <td className="td"><PoLink id={v.po.id} number={v.po.poNumber} /><div className="text-xs text-muted">{v.po.productName}</div></td>
                      {!isVendor && <td className="td">{v.vendor.name.split(" ").slice(1, 3).join(" ")}<div className="text-xs text-muted">{v.vendor.advancePct}% adv · {v.vendor.creditDays}d credit</div></td>}
                      <td className="td capitalize">{p.milestone}</td>
                      <td className="td tnum text-right font-medium">{usd(p.amountUsd)}</td>
                      <td className="td whitespace-nowrap">{fmtDate(p.dueDate, true)}<div className={`text-xs ${overdue ? "font-medium text-red-600" : "text-muted"}`}>{relDays(p.dueDate, snap.now)}</div></td>
                      <td className="td text-xs">
                        {p.milestone === "advance" ? <span className="text-muted">Not needed for advance</span> : (
                          <div className="space-y-0.5">
                            <div>PO {num(v.po.totalQty)} · GRN {num(grnQty)}{lost ? <span className="text-red-600"> ({num(lost)} lost)</span> : ""}</div>
                            <div>{invoice.length === 0 ? <span className="text-amber-700">Invoice not uploaded</span> : invoiceOk ? <span className="text-emerald-700">Invoice matches</span> : <span className="font-medium text-red-600">Invoice mismatch</span>}</div>
                          </div>
                        )}
                      </td>
                      <td className="td"><Badge tone={p.status === "on_hold" ? "red" : overdue ? "red" : "amber"}>{p.status === "on_hold" ? "On hold" : overdue ? "Overdue" : "Pending"}</Badge>{p.holdReason && <div className="mt-1 max-w-48 text-xs text-red-600">{p.holdReason}</div>}</td>
                      {isFinance && (
                        <td className="td">
                          {p.status === "pending" ? (
                            <div className="flex flex-col gap-2">
                              <ActionForm action={releasePayment} hidden={{ paymentId: p.id }} submit="Release" small confirm={`Release ${usd(p.amountUsd)} to ${v.vendor.name}?`} />
                              <ActionForm action={setPaymentHold} hidden={{ paymentId: p.id, hold: "1" }} submit="Hold" small variant="plain" className="flex items-center gap-2 [&>div]:mt-0"><input name="reason" placeholder="Reason" className="input w-28 py-1 text-xs" /></ActionForm>
                            </div>
                          ) : (
                            <ActionForm action={setPaymentHold} hidden={{ paymentId: p.id, hold: "0" }} submit="Clear hold" small variant="plain" className="flex items-center gap-2 [&>div]:mt-0"><input name="reason" placeholder="Resolution" className="input w-28 py-1 text-xs" /></ActionForm>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="Recently paid" pad={false}>
        <TableWrap>
          <table className="w-full">
            <tbody className="divide-y divide-line">
              {paid.map(({ p, v }) => (
                <tr key={p.id}>
                  <td className="td"><PoLink id={v.po.id} number={v.po.poNumber} /></td>
                  {!isVendor && <td className="td">{v.vendor.name}</td>}
                  <td className="td capitalize text-muted">{p.milestone}</td>
                  <td className="td tnum text-right">{usd(p.amountUsd)}</td>
                  <td className="td whitespace-nowrap text-xs text-muted">Paid {fmtDate(p.paidAt, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}

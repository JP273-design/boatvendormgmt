import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { AiBox } from "@/components/ai-box";
import { DocumentUpload } from "@/components/document-upload";
import { LogisticsActions, ReceiveForm, ShipForm } from "@/components/lot-forms";
import { Badge, Card, Empty, Milestones, PageHeader, RiskBadge, StageBadge, TableWrap } from "@/components/ui";
import type { Lot } from "@/db/schema";
import { getPoEvents, getSnapshot, getTemplates, scopeViews, type PoView } from "@/lib/data";
import { fmtDate, fmtDateTime, isoDate, LOT_STAGE_LABEL, num, relDays, usd, DAY } from "@/lib/format";
import type { Persona } from "@/lib/personas";
import { requirePersona } from "@/lib/session";
import { nextAction } from "@/lib/tasks";
import { acceptPo, createLot, explainRisk, releasePayment, requestQc, scheduleQc, setPaymentHold, updateProduction } from "../../../actions";

const INSPECTORS = ["Rohan Mehta", "Priya Nair", "Arjun Rao"];
const DOC_LABEL = { packing_list: "Packing list", bill_of_lading: "Bill of lading", invoice: "Invoice", other: "Document" } as const;

export default async function PoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const persona = await requirePersona();
  const snap = await getSnapshot();
  const v = scopeViews(snap, persona).find((x) => x.po.id === id);
  if (!v) notFound();
  const [events, templates] = await Promise.all([getPoEvents(id), getTemplates()]);
  const { po, vendor } = v;
  const action = nextAction(v, persona, snap.now);
  const allotted = v.lots.reduce((a, l) => a + l.qty, 0);
  // logistics can always update a lot that is at sea, even before its ETA is due
  const logisticsCanAct = persona.role === "logistics" && v.lots.some((l) => l.status === "SHIPPED");
  const canUpload = ["vendor", "procurement", "logistics", "finance"].includes(persona.role);

  return (
    <>
      <div className="mb-2 text-xs text-muted">
        <Link href="/pos" className="hover:underline">Purchase orders</Link> / <span className="font-mono">{po.poNumber}</span>
      </div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">PO <span className="font-mono">{po.poNumber}</span> <StageBadge view={v} /> <RiskBadge risk={v.risk} /></span>}
        subtitle={
          <>
            {po.productName} · {num(po.totalQty)} units · {usd(po.totalValueUsd)} ·{" "}
            {persona.role === "vendor" ? vendor.name : <Link href={`/vendors/${vendor.id}`} className="underline decoration-slate-300 underline-offset-2">{vendor.name}</Link>}
          </>
        }
      />

      <Card className="mb-4">
        <Milestones index={v.milestone} failed={po.status === "QC_FAILED"} labels />
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <Fact label="Issued from SAP" value={fmtDate(po.issuedAt, true)} />
          <Fact label="Lead time" value={po.promisedLeadDays ? `${po.promisedLeadDays} days promised` : `${po.requestedLeadDays} days requested`} sub={po.promisedLeadDays && po.promisedLeadDays > po.requestedLeadDays ? `${po.promisedLeadDays - po.requestedLeadDays} days over request` : undefined} />
          <Fact label="Promised ready" value={po.promisedReadyDate ? fmtDate(po.promisedReadyDate, true) : "Awaiting vendor"} sub={po.promisedReadyDate && !po.qcPassedAt ? relDays(po.promisedReadyDate, snap.now) : po.qcPassedAt ? `QC passed ${fmtDate(po.qcPassedAt)}` : undefined} />
          <Fact label="Payment terms" value={`${vendor.advancePct}% advance`} sub={`Balance ${vendor.creditDays} days after GRN`} />
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {(action || logisticsCanAct) && (
            <Card title={<span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-500" /> {action ? `Your next step - ${action}` : "Shipment updates"}</span>} className={action ? "border-amber-300 ring-2 ring-amber-100" : ""}>
              <ActionPanel v={v} persona={persona} now={snap.now} allotted={allotted} />
            </Card>
          )}

          {(po.status === "IN_PRODUCTION" || po.status === "ACCEPTED") && (
            <Card title="Production">
              <div className="flex items-center gap-3">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-navy" style={{ width: `${po.productionPct}%` }} />
                </div>
                <span className="tnum text-sm font-semibold">{po.productionPct}%</span>
              </div>
              <p className="mt-2 text-xs text-muted">As reported by the vendor. The risk engine compares this with where the plan says it should be today.</p>
            </Card>
          )}

          <Card title="Order lines" pad={false}>
            <TableWrap>
              <table className="w-full">
                <thead className="border-b border-line bg-slate-50/60">
                  <tr><th className="th">SKU</th><th className="th">Description</th><th className="th text-right">Qty</th><th className="th text-right">Unit price</th><th className="th text-right">Value</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {po.lines.map((l) => (
                    <tr key={l.sku}>
                      <td className="td font-mono text-xs">{l.sku}</td>
                      <td className="td">{l.description}</td>
                      <td className="td tnum text-right">{num(l.qty)}</td>
                      <td className="td tnum text-right">${l.unitPriceUsd.toFixed(2)}</td>
                      <td className="td tnum text-right">{usd(l.qty * l.unitPriceUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          {v.inspections.length > 0 && (
            <Card title="Quality inspections">
              <div className="space-y-3">
                {[...v.inspections].reverse().map((q) => {
                  const items = templates.find((t) => t.id === q.templateId)?.items ?? [];
                  const fails = q.results.filter((r) => r.result === "fail");
                  return (
                    <div key={q.id} className="rounded-lg border border-line p-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">Inspection {q.attempt}</span>
                        <Badge tone={q.status === "PASSED" ? "green" : q.status === "FAILED" ? "red" : "violet"}>{q.status === "REQUESTED" ? "Waiting to be scheduled" : q.status === "SCHEDULED" ? `Scheduled ${fmtDate(q.scheduledFor)}` : q.status === "PASSED" ? "Passed" : "Failed"}</Badge>
                        <span className="text-xs text-muted">
                          {q.inspectorName ?? "No inspector yet"} · sample {q.sampleSize} units{q.completedAt ? ` · ${fmtDate(q.completedAt, true)}` : ""}
                        </span>
                        <Link href={`/qc/${q.id}`} className="ml-auto text-xs font-medium underline decoration-slate-300 underline-offset-2">{q.status === "SCHEDULED" && persona.role === "qc" ? "Start inspection" : "View checklist"}</Link>
                      </div>
                      {q.summary && <p className="mt-1.5 text-sm text-slate-600">{q.summary}</p>}
                      {fails.length > 0 && (
                        <ul className="mt-2 space-y-1.5">
                          {fails.map((r) => {
                            const it = items.find((i) => i.id === r.itemId);
                            return (
                              <li key={r.itemId} className="flex gap-2 text-sm">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                                <span>
                                  <span className="font-medium">{it?.check ?? r.itemId}</span>
                                  {it?.critical && <Badge tone="red" className="ml-1.5">Critical</Badge>}
                                  {r.note && <span className="block text-slate-600">{r.note}</span>}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {(v.lots.length > 0 || po.status === "QC_PASSED") && (
            <Card title="Lots and shipments" action={<span className="text-xs text-muted">{num(allotted)} of {num(po.totalQty)} units allotted</span>}>
              {v.lots.length === 0 ? (
                <Empty>QC has passed. The vendor creates a lot ID next, then adds the container and shipping details.</Empty>
              ) : (
                <div className="space-y-3">
                  {v.lots.map((l) => <LotCard key={l.id} lot={l} v={v} now={snap.now} />)}
                </div>
              )}
            </Card>
          )}

          {(v.docs.length > 0 || (canUpload && v.lots.length > 0)) && (
            <Card title="Documents" action={<span className="text-xs text-muted">Read by Claude, matched against PO and lot</span>}>
              {v.docs.length > 0 && (
                <ul className="mb-3 divide-y divide-line">
                  {v.docs.map((d) => (
                    <li key={d.id} className="py-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <FileText className="h-4 w-4 text-slate-400" />
                        <span className="font-medium">{d.fileName}</span>
                        <span className="text-xs text-muted">{DOC_LABEL[d.type]}{d.lotId ? ` · ${v.lots.find((l) => l.id === d.lotId)?.lotNumber ?? ""}` : ""} · {d.uploadedBy}</span>
                        <Badge tone={d.matchStatus === "match" ? "green" : "red"} className="ml-auto">{d.matchStatus === "match" ? <><CheckCircle2 className="h-3 w-3" /> Matches</> : `${d.issues.length} mismatch${d.issues.length > 1 ? "es" : ""}`}</Badge>
                      </div>
                      {d.issues.length > 0 && (
                        <table className="mt-2 w-full text-xs">
                          <thead><tr className="text-left text-muted"><th className="py-1 font-medium">Field</th><th className="py-1 font-medium">System says</th><th className="py-1 font-medium">Document says</th></tr></thead>
                          <tbody>
                            {d.issues.map((i) => (
                              <tr key={i.field} className="border-t border-line"><td className="py-1.5 font-medium">{i.field}</td><td className="py-1.5">{i.expected}</td><td className="py-1.5 font-medium text-red-600">{i.found}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canUpload && <DocumentUpload poId={po.id} lots={v.lots.map((l) => ({ id: l.id, lotNumber: l.lotNumber }))} />}
            </Card>
          )}

          {v.payments.length > 0 && (
            <Card title="Payments" pad={false}>
              <TableWrap>
                <table className="w-full">
                  <thead className="border-b border-line bg-slate-50/60">
                    <tr><th className="th">Milestone</th><th className="th text-right">Amount</th><th className="th">Due</th><th className="th">Status</th><th className="th" /></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {v.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="td">{p.milestone === "advance" ? `Advance (${vendor.advancePct}%)` : `Balance (GRN + ${vendor.creditDays} days)`}</td>
                        <td className="td tnum text-right">{usd(p.amountUsd)}</td>
                        <td className="td whitespace-nowrap">{fmtDate(p.dueDate, true)}{p.status !== "paid" && <div className="text-xs text-muted">{relDays(p.dueDate, snap.now)}</div>}</td>
                        <td className="td">
                          <Badge tone={p.status === "paid" ? "green" : p.status === "on_hold" ? "red" : "amber"}>{p.status === "paid" ? `Paid ${fmtDate(p.paidAt)}` : p.status === "on_hold" ? "On hold" : "Pending"}</Badge>
                          {p.holdReason && <div className="mt-1 text-xs text-red-600">{p.holdReason}</div>}
                        </td>
                        <td className="td">
                          {persona.role === "finance" && p.status === "pending" && <ActionForm action={releasePayment} hidden={{ paymentId: p.id }} submit="Release" small confirm={`Release ${usd(p.amountUsd)} to ${vendor.name}?`} />}
                          {persona.role === "finance" && p.status === "on_hold" && <ActionForm action={setPaymentHold} hidden={{ paymentId: p.id, hold: "0" }} submit="Clear hold" small variant="plain"><input name="reason" placeholder="Resolution note" className="input py-1.5 text-xs" /></ActionForm>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {v.open && (
            <Card title="Delay risk" action={<span className={clsx("tnum text-lg font-semibold", v.risk.level === "high" ? "text-red-600" : v.risk.level === "medium" ? "text-amber-600" : "text-emerald-600")}>{v.risk.score}<span className="text-xs font-normal text-muted">/100</span></span>}>
              {v.risk.factors.length === 0 ? (
                <p className="text-sm text-muted">On track. No risk signals on this order.</p>
              ) : (
                <>
                  {v.risk.projectedDelayDays > 0 && <p className="mb-3 text-sm">Projected <span className="font-semibold">~{v.risk.projectedDelayDays} days late</span></p>}
                  <ul className="mb-3 space-y-2.5">
                    {v.risk.factors.map((f) => (
                      <li key={f.label} className="text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{f.label}</span>
                          <span className="tnum text-xs text-muted">+{f.points}</span>
                        </div>
                        <div className="text-xs text-slate-600">{f.detail}</div>
                      </li>
                    ))}
                  </ul>
                  <AiBox label="Explain and suggest actions" run={explainRisk.bind(null, po.id)} />
                </>
              )}
            </Card>
          )}

          <Card title="Timeline">
            <ol className="relative space-y-4 border-l border-line pl-4">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className={clsx("absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white", /FAILED|MISMATCH|HELD/.test(e.type) ? "bg-red-500" : /PASSED|CLOSED|RELEASED|GRN/.test(e.type) ? "bg-emerald-500" : "bg-slate-300")} />
                  <div className="text-sm">{e.message}</div>
                  <div className="text-xs text-muted">{e.actorName} · {fmtDateTime(e.at)}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}

function LotCard({ lot: l, v, now }: { lot: Lot; v: PoView; now: Date }) {
  const grn = v.grns.find((g) => g.lotId === l.id);
  const slip = l.eta && l.originalEta ? Math.round((l.eta.getTime() - l.originalEta.getTime()) / DAY) : 0;
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono font-medium">{l.lotNumber}</span>
        <Badge tone={l.status === "RECEIVED" ? "green" : l.status === "AT_PORT" ? "amber" : "blue"}>{LOT_STAGE_LABEL[l.status]}</Badge>
        <span className="text-xs text-muted">{num(l.qty)} units · {num(l.cartons)} cartons</span>
      </div>
      {l.containerNo ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Fact label="Container" value={l.containerNo} sub={l.carrier ?? undefined} />
          <Fact label="Vessel" value={l.vessel ?? "-"} sub={`B/L ${l.blNo}`} />
          <Fact label="Route" value={`${l.portOfLoading} → ${l.portOfDischarge?.split(" (")[0]}`} sub={`ETD ${fmtDate(l.etd)}`} />
          <Fact
            label={l.arrivedAt ? "Arrived" : "ETA"}
            value={fmtDate(l.arrivedAt ?? l.eta, true)}
            sub={l.status === "AT_PORT" && l.arrivedAt ? `${Math.floor((now.getTime() - l.arrivedAt.getTime()) / DAY)} days at port` : slip > 0 && !l.arrivedAt ? `Slipped ${slip} days` : l.receivedAt ? `Received ${fmtDate(l.receivedAt)}` : undefined}
          />
        </dl>
      ) : (
        <p className="mt-2 text-xs text-muted">Waiting for the vendor to add container and shipping details.</p>
      )}
      {grn && (
        <p className="mt-2 text-xs text-slate-600">
          GRN <span className="font-mono">{grn.grnNumber}</span> · {num(grn.receivedQty)} received{grn.damagedQty ? ` · ${num(grn.damagedQty)} damaged` : ""}{grn.shortQty ? ` · ${num(grn.shortQty)} short` : ""}{grn.note ? ` · ${grn.note}` : ""}
        </p>
      )}
    </div>
  );
}

/** The form for whatever this persona should do next on this PO. */
function ActionPanel({ v, persona, now, allotted }: { v: PoView; persona: Persona; now: Date; allotted: number }) {
  const { po } = v;
  const hidden = { poId: po.id };

  if (persona.role === "vendor") {
    if (po.status === "ISSUED") {
      return (
        <ActionForm action={acceptPo} hidden={hidden} submit="Accept order">
          <p className="mb-3 text-sm text-slate-600">boAt has asked for delivery readiness in {po.requestedLeadDays} days. Confirm the lead time you can commit to - this becomes the promised date everyone tracks.</p>
          <label className="label" htmlFor="leadDays">Lead time you promise (days)</label>
          <input id="leadDays" name="leadDays" type="number" min={7} max={180} defaultValue={po.requestedLeadDays} className="input w-32" required />
        </ActionForm>
      );
    }
    if (po.status === "ACCEPTED" || po.status === "IN_PRODUCTION") {
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <ActionForm action={updateProduction} hidden={hidden} submit="Update progress" variant="dark">
            <label className="label" htmlFor="pct">Production complete (%)</label>
            <input id="pct" name="pct" type="number" min={0} max={100} defaultValue={po.productionPct} className="input w-32" required />
          </ActionForm>
          <div>
            <p className="mb-3 text-sm text-slate-600">Goods finished and packed ? Ask boAt to send an inspector.</p>
            <ActionForm action={requestQc} hidden={hidden} submit="Request QC inspection" />
          </div>
        </div>
      );
    }
    if (po.status === "QC_FAILED") {
      return (
        <>
          <p className="mb-3 text-sm text-slate-600">Fix the failed checks listed under Quality inspections, then ask for re-inspection.</p>
          <ActionForm action={requestQc} hidden={hidden} submit="Rework done - request re-inspection" />
        </>
      );
    }
    const newLot = v.lots.find((l) => l.status === "CREATED");
    if (newLot) return <ShipForm lot={newLot} now={now} />;
    if (po.status === "QC_PASSED" || allotted < po.totalQty) {
      const remaining = po.totalQty - allotted;
      return (
        <ActionForm action={createLot} hidden={hidden} submit="Create lot ID">
          <p className="mb-3 text-sm text-slate-600">{num(remaining)} units are QC-passed and not yet in a lot. Ship everything in one lot, or split across containers.</p>
          <div className="grid max-w-md grid-cols-2 gap-3">
            <div><label className="label" htmlFor="qty">Units in this lot</label><input id="qty" name="qty" type="number" min={1} max={remaining} defaultValue={remaining} className="input" required /></div>
            <div><label className="label" htmlFor="cartons">Cartons</label><input id="cartons" name="cartons" type="number" min={1} defaultValue={Math.ceil(remaining / 12)} className="input" required /></div>
          </div>
        </ActionForm>
      );
    }
  }

  if (persona.role === "procurement" && po.status === "QC_REQUESTED") {
    const insp = v.inspections.find((i) => i.status === "REQUESTED");
    if (!insp) return null;
    return (
      <ActionForm action={scheduleQc} hidden={{ inspectionId: insp.id }} submit="Schedule inspection">
        <p className="mb-3 text-sm text-slate-600">The vendor asked for inspection {relDays(insp.requestedAt, now)}. Every day here is a day added to the lead time.</p>
        <div className="grid max-w-md grid-cols-2 gap-3">
          <div><label className="label" htmlFor="date">Inspection date</label><input id="date" name="date" type="date" defaultValue={isoDate(new Date(now.getTime() + 2 * DAY))} min={isoDate(now)} className="input" required /></div>
          <div><label className="label" htmlFor="inspector">Inspector</label><select id="inspector" name="inspector" className="input">{INSPECTORS.map((n) => <option key={n}>{n}</option>)}</select></div>
        </div>
      </ActionForm>
    );
  }

  if (persona.role === "qc") {
    const insp = v.inspections.find((i) => i.status === "SCHEDULED");
    return insp ? <Link href={`/qc/${insp.id}`} className="btn btn-primary">Open inspection checklist</Link> : null;
  }

  if (persona.role === "logistics") {
    return (
      <div className="space-y-4">
        {v.lots.filter((l) => ["SHIPPED", "AT_PORT", "CUSTOMS_CLEARED"].includes(l.status)).map((l) => <LogisticsActions key={l.id} lot={l} />)}
      </div>
    );
  }

  if (persona.role === "warehouse") {
    return (
      <div className="space-y-4">
        {v.lots.filter((l) => l.status === "PICKED_UP").map((l) => <ReceiveForm key={l.id} lot={l} />)}
      </div>
    );
  }

  if (persona.role === "finance") return <p className="text-sm text-slate-600">Review the documents and GRN, then release or clear the hold in the Payments section below.</p>;
  return null;
}

import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader, PoLink } from "@/components/ui";
import { getSnapshot, scopeViews } from "@/lib/data";
import { DAY, fmtDate, isoDate, num, relDays } from "@/lib/format";
import { requirePersona } from "@/lib/session";
import { scheduleQc } from "../../actions";

const INSPECTORS = ["Rohan Mehta", "Priya Nair", "Arjun Rao"];

export default async function QcPage() {
  const persona = await requirePersona();
  const snap = await getSnapshot();
  const all = scopeViews(snap, persona).flatMap((v) => v.inspections.map((q) => ({ q, v })));
  const requested = all.filter((x) => x.q.status === "REQUESTED");
  const scheduled = all.filter((x) => x.q.status === "SCHEDULED").sort((a, b) => (a.q.scheduledFor?.getTime() ?? 0) - (b.q.scheduledFor?.getTime() ?? 0));
  const done = all.filter((x) => x.q.completedAt).sort((a, b) => b.q.completedAt!.getTime() - a.q.completedAt!.getTime()).slice(0, 12);
  const isQc = persona.role === "qc";

  return (
    <>
      <PageHeader title={isQc ? "My inspections" : "QC inspections"} subtitle="Pre-shipment inspections at the vendor's factory" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`To inspect · ${scheduled.length}`}>
          {scheduled.length === 0 ? <Empty>No inspections scheduled.</Empty> : (
            <ul className="space-y-3">
              {scheduled.map(({ q, v }) => (
                <li key={q.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{v.po.productName}</div>
                      <div className="text-xs text-muted">{v.vendor.name} · {v.vendor.city}</div>
                      <div className="mt-1 text-xs text-muted"><PoLink id={v.po.id} number={v.po.poNumber} /> · {num(v.po.totalQty)} units · sample {q.sampleSize}{q.attempt > 1 ? ` · re-inspection ${q.attempt}` : ""}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold">{fmtDate(q.scheduledFor)}</div>
                      <div className="text-xs text-muted">{q.scheduledFor ? relDays(q.scheduledFor, snap.now) : ""}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted">{q.inspectorName}</span>
                    <Link href={`/qc/${q.id}`} className={`btn btn-sm ${isQc ? "btn-primary" : ""}`}>{isQc ? "Start inspection" : "View checklist"}</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Waiting to be scheduled · ${requested.length}`}>
          {requested.length === 0 ? <Empty>No open requests from vendors.</Empty> : (
            <ul className="space-y-3">
              {requested.map(({ q, v }) => (
                <li key={q.id} className="rounded-lg border border-line p-3">
                  <div className="text-sm font-medium">{v.po.productName}</div>
                  <div className="text-xs text-muted">{v.vendor.name} · <PoLink id={v.po.id} number={v.po.poNumber} /> · requested {relDays(q.requestedAt, snap.now)}</div>
                  {persona.role === "procurement" ? (
                    <ActionForm action={scheduleQc} hidden={{ inspectionId: q.id }} submit="Schedule" small className="mt-3">
                      <div className="flex gap-2">
                        <input name="date" type="date" defaultValue={isoDate(new Date(snap.now.getTime() + 2 * DAY))} min={isoDate(snap.now)} className="input py-1.5 text-xs" aria-label="Inspection date" required />
                        <select name="inspector" className="input py-1.5 text-xs" aria-label="Inspector">{INSPECTORS.map((n) => <option key={n}>{n}</option>)}</select>
                      </div>
                    </ActionForm>
                  ) : (
                    <p className="mt-2 text-xs text-muted">Procurement schedules the visit.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recently completed" className="mt-4" pad={false}>
        <ul className="divide-y divide-line">
          {done.map(({ q, v }) => (
            <li key={q.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <Badge tone={q.status === "PASSED" ? "green" : "red"}>{q.status === "PASSED" ? "Passed" : "Failed"}</Badge>
              <span className="font-medium">{v.po.productName}</span>
              <span className="text-xs text-muted">{v.vendor.name} · <PoLink id={v.po.id} number={v.po.poNumber} /></span>
              <span className="ml-auto text-xs text-muted">{q.inspectorName} · {fmtDate(q.completedAt, true)}</span>
              <Link href={`/qc/${q.id}`} className="text-xs font-medium underline decoration-slate-300 underline-offset-2">Report</Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

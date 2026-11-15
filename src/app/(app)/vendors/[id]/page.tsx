import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { AiBox } from "@/components/ai-box";
import { Card, Empty, PageHeader, PoLink, RiskBadge, StageBadge, Stat, TableWrap } from "@/components/ui";
import { getSnapshot, getTemplates } from "@/lib/data";
import { DAY, fmtDate, pct, usd } from "@/lib/format";
import { requirePersona } from "@/lib/session";
import { vendorSummary } from "../../../actions";

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const persona = await requirePersona();
  if (persona.role === "vendor") return <Empty>Not available for vendors.</Empty>;
  const snap = await getSnapshot();
  const vendor = snap.vendors.find((v) => v.id === id);
  if (!vendor) notFound();
  const s = snap.stats.get(id)!;
  const mine = snap.views.filter((v) => v.vendor.id === id);
  const templates = await getTemplates();

  const defects = new Map<string, { check: string; fails: number; note?: string }>();
  for (const v of mine) for (const q of v.inspections) for (const r of q.results) {
    if (r.result !== "fail") continue;
    const check = templates.find((t) => t.id === q.templateId)?.items.find((i) => i.id === r.itemId)?.check ?? r.itemId;
    const d = defects.get(check) ?? { check, fails: 0, note: r.note };
    d.fails++;
    defects.set(check, d);
  }
  const topDefects = [...defects.values()].sort((a, b) => b.fails - a.fails).slice(0, 6);
  const maxFails = topDefects[0]?.fails ?? 1;
  const history = mine.filter((v) => v.po.qcPassedAt && v.po.promisedReadyDate).sort((a, b) => b.po.qcPassedAt!.getTime() - a.po.qcPassedAt!.getTime()).slice(0, 12).reverse();

  return (
    <>
      <div className="mb-2 text-xs text-muted"><Link href="/vendors" className="hover:underline">Vendors</Link> / {vendor.name}</div>
      <PageHeader title={vendor.name} subtitle={`${vendor.city} · contact ${vendor.contactName} · ${vendor.advancePct}% advance, balance ${vendor.creditDays} days after GRN · vendor since ${fmtDate(vendor.onboardedAt, true)}`} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Vendor score" value={s.score ?? "-"} tone={(s.score ?? 0) >= 85 ? "green" : (s.score ?? 0) >= 70 ? "amber" : "red"} sub="out of 100" />
        <Stat label="Ready on time" value={pct(s.onTimePct)} sub={`${s.completed} orders · last 120 days ${pct(s.recentOnTimePct)}`} />
        <Stat label="Average delay" value={s.avgDelayDays !== null ? `${s.avgDelayDays.toFixed(1)} d` : "-"} sub="vs promised ready date" />
        <Stat label="QC first-pass" value={pct(s.firstPassPct)} sub={`documents ${pct(s.docAccuracyPct)} accurate`} />
        <Stat label="Open exposure" value={usd(s.openValueUsd, true)} sub={`${s.openPos} open orders`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand" /> Vendor review</span>}>
          <p className="mb-3 text-xs text-muted">Claude reads this vendor&apos;s delivery record, QC failures and open orders against its peers.</p>
          <AiBox label="Write vendor review" run={vendorSummary.bind(null, id)} auto />
        </Card>

        <Card title="Days late vs promise - last 12 orders">
          {history.length === 0 ? <Empty>No completed orders yet.</Empty> : (
            <div className="flex h-40 items-end gap-1.5">
              {history.map((v) => {
                const late = Math.round((v.po.qcPassedAt!.getTime() - v.po.promisedReadyDate!.getTime()) / DAY);
                const h = Math.min(100, Math.max(6, Math.abs(late) * 6));
                return (
                  <Link key={v.po.id} href={`/pos/${v.po.id}`} title={`${v.po.poNumber}: ${late > 0 ? `${late} days late` : late < 0 ? `${-late} days early` : "on time"}`} className="group flex flex-1 flex-col items-center justify-end">
                    <span className="tnum mb-1 text-[10px] text-muted">{late > 0 ? `+${late}` : late}</span>
                    <span className={`w-full rounded-t ${late > 1 ? "bg-red-400 group-hover:bg-red-500" : "bg-emerald-400 group-hover:bg-emerald-500"}`} style={{ height: `${h}%` }} />
                  </Link>
                );
              })}
            </div>
          )}
          <p className="mt-2 text-xs text-muted">Oldest to newest. Red = more than a day late.</p>
        </Card>

        <Card title="What fails QC here">
          {topDefects.length === 0 ? <Empty>No failed checks on record.</Empty> : (
            <ul className="space-y-3">
              {topDefects.map((d) => (
                <li key={d.check}>
                  <div className="flex justify-between gap-3 text-sm"><span>{d.check}</span><span className="tnum shrink-0 font-medium">{d.fails}×</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-red-400" style={{ width: `${(d.fails / maxFails) * 100}%` }} /></div>
                  {d.note && <div className="mt-1 text-xs text-muted">e.g. {d.note}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Open orders" pad={false} className="mt-4">
        {mine.filter((v) => v.open).length === 0 ? <div className="p-4"><Empty>No open orders.</Empty></div> : (
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-line bg-slate-50/60"><tr><th className="th">PO</th><th className="th">Product</th><th className="th text-right">Value</th><th className="th">Stage</th><th className="th">Promised ready</th><th className="th">Risk</th></tr></thead>
              <tbody className="divide-y divide-line">
                {mine.filter((v) => v.open).map((v) => (
                  <tr key={v.po.id}>
                    <td className="td"><PoLink id={v.po.id} number={v.po.poNumber} /></td>
                    <td className="td">{v.po.productName}</td>
                    <td className="td tnum text-right">{usd(v.po.totalValueUsd, true)}</td>
                    <td className="td"><StageBadge view={v} /></td>
                    <td className="td">{fmtDate(v.po.promisedReadyDate)}</td>
                    <td className="td"><RiskBadge risk={v.risk} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

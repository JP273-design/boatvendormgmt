import Link from "next/link";
import { Sparkles } from "lucide-react";
import { AiBox } from "@/components/ai-box";
import { CashChart, OnTimeChart, PipelineChart } from "@/components/charts";
import { Badge, Card, Empty, PageHeader, PoLink, RiskBadge, Stat, TableWrap } from "@/components/ui";
import { getSnapshot, scopeAlerts } from "@/lib/data";
import { DAY, fmtDate, pct, usd } from "@/lib/format";
import { requirePersona } from "@/lib/session";
import { dailyBrief } from "../../actions";

const STAGES = ["Awaiting vendor", "Accepted", "Production", "QC", "At sea", "Port to WH", "Closed, unpaid"];

export default async function DashboardPage() {
  const persona = await requirePersona();
  if (persona.role === "vendor") return <Empty>Not available for vendors.</Empty>;
  const snap = await getSnapshot();
  const now = snap.now.getTime();
  const unpaid = snap.views.filter((v) => v.po.status !== "PAID");
  const open = snap.views.filter((v) => v.open);
  const sum = (list: typeof open) => list.reduce((a, v) => a + v.po.totalValueUsd, 0);
  const risky = open.filter((v) => v.risk.level !== "low").sort((a, b) => b.risk.score - a.risk.score);
  const high = open.filter((v) => v.risk.level === "high");
  const transit = open.flatMap((v) => v.lots.filter((l) => l.status !== "RECEIVED" && l.status !== "CREATED").map((l) => (l.qty / v.po.totalQty) * v.po.totalValueUsd));

  // 12-month on-time (goods QC-passed by the promised ready date)
  const done = snap.views.filter((v) => v.po.qcPassedAt && v.po.promisedReadyDate);
  const isOnTime = (v: (typeof done)[number]) => v.po.qcPassedAt!.getTime() - v.po.promisedReadyDate!.getTime() <= DAY;
  const onTimePct = done.length ? (done.filter(isOnTime).length / done.length) * 100 : null;
  const firstQc = snap.inspections.filter((q) => q.attempt === 1 && q.completedAt);
  const firstPass = firstQc.length ? (firstQc.filter((q) => q.status === "PASSED").length / firstQc.length) * 100 : null;

  const pipeline = STAGES.map((stage, i) => {
    const at = unpaid.filter((v) => v.milestone === i);
    const riskValue = sum(at.filter((v) => v.risk.level !== "low"));
    return { stage, count: at.length, value: sum(at) - riskValue, atRisk: riskValue };
  });

  const months = Array.from({ length: 9 }, (_, i) => {
    const d = new Date(snap.now);
    d.setDate(1);
    d.setMonth(d.getMonth() - (8 - i));
    return d;
  });
  const trend = months.map((m) => {
    const inMonth = done.filter((v) => v.po.qcPassedAt!.getFullYear() === m.getFullYear() && v.po.qcPassedAt!.getMonth() === m.getMonth());
    return { month: m.toLocaleDateString("en-GB", { month: "short" }), orders: inMonth.length, onTime: inMonth.length ? Math.round((inMonth.filter(isOnTime).length / inMonth.length) * 100) : null };
  });

  const openPay = snap.payments.filter((p) => p.status !== "paid");
  const cash = Array.from({ length: 8 }, (_, i) => {
    const from = i === 0 ? -Infinity : now + i * 7 * DAY;
    const to = now + (i + 1) * 7 * DAY;
    const inWeek = openPay.filter((p) => p.dueDate.getTime() >= from && p.dueDate.getTime() < to);
    return {
      week: i === 0 ? "This wk" : `+${i}w`,
      amount: Math.round(inWeek.filter((p) => p.status === "pending").reduce((a, p) => a + p.amountUsd, 0)),
      held: Math.round(inWeek.filter((p) => p.status === "on_hold").reduce((a, p) => a + p.amountUsd, 0)),
    };
  });

  const league = snap.vendors.map((v) => ({ v, s: snap.stats.get(v.id)! })).sort((a, b) => (b.s.score ?? 0) - (a.s.score ?? 0));
  const otherAlerts = scopeAlerts(snap, persona).filter((a) => a.kind !== "Delay risk" && a.severity === "high");

  return (
    <>
      <PageHeader title={`Good ${new Date(now + 5.5 * 3600_000).getUTCHours() < 12 ? "morning" : "afternoon"}, ${persona.name.split(" ")[0]}`} subtitle={`Supply position as of ${fmtDate(snap.now, true)} - China-sourced speakers and soundbars`} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Open PO value" value={usd(sum(open), true)} sub={`${open.length} orders with ${snap.vendors.length} vendors`} />
        <Stat label="Value at risk of delay" value={usd(sum(risky), true)} tone={high.length ? "red" : "amber"} sub={`${high.length} high · ${risky.length - high.length} watch`} />
        <Stat label="Goods in transit" value={usd(transit.reduce((a, b) => a + b, 0), true)} sub={`${transit.length} containers`} />
        <Stat label="Ready on time (12 mo)" value={pct(onTimePct)} tone={onTimePct !== null && onTimePct < 85 ? "amber" : "green"} sub="target 85%" />
        <Stat label="QC first-pass (12 mo)" value={pct(firstPass)} tone={firstPass !== null && firstPass < 85 ? "amber" : "green"} sub={`${firstQc.length} inspections`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand" /> Today&apos;s brief</span>} className="lg:row-span-2">
          <p className="mb-3 text-xs text-muted">Claude reads every open order, alert and vendor score, and tells you what needs you today.</p>
          <AiBox label="Generate today's brief" run={dailyBrief} auto />
          {otherAlerts.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Exceptions</div>
              <ul className="space-y-2.5">
                {otherAlerts.slice(0, 4).map((a) => (
                  <li key={a.id} className="text-sm">
                    <Badge tone="red">{a.kind}</Badge> <PoLink id={a.poId} number={a.poNumber} />
                    <div className="mt-0.5 text-xs text-slate-600">{a.detail}</div>
                  </li>
                ))}
              </ul>
              <Link href="/alerts" className="mt-3 inline-block text-xs font-medium underline decoration-slate-300 underline-offset-2">All alerts</Link>
            </div>
          )}
        </Card>

        <Card title="Where the money is" action={<span className="flex items-center gap-3 text-xs text-muted"><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-navy" /> on track</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-brand" /> at risk</span></span>} className="lg:col-span-2">
          <PipelineChart data={pipeline} />
        </Card>

        <Card title="Orders ready on time, by month">
          <OnTimeChart data={trend} />
        </Card>
        <Card title="Cash out to vendors, next 8 weeks">
          <CashChart data={cash} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Orders most likely to be late" pad={false} action={<Link href="/pos?f=risk" className="text-xs font-medium underline decoration-slate-300 underline-offset-2">All at-risk</Link>}>
          {risky.length === 0 ? <div className="p-4"><Empty>Everything is on track.</Empty></div> : (
            <ul className="divide-y divide-line">
              {risky.slice(0, 6).map((v) => (
                <li key={v.po.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 text-sm"><PoLink id={v.po.id} number={v.po.poNumber} /> <span className="font-medium">{v.po.productName}</span></div>
                    <div className="text-xs text-muted">{v.vendor.name} · {usd(v.po.totalValueUsd, true)} · {v.stage}</div>
                    <div className="mt-1 text-xs text-slate-600">{v.risk.factors[0]?.detail}</div>
                  </div>
                  <div className="shrink-0 text-right"><RiskBadge risk={v.risk} />{v.risk.projectedDelayDays > 0 && <div className="mt-1 text-xs text-muted">~{v.risk.projectedDelayDays}d late</div>}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Vendor league table" pad={false} action={<Link href="/vendors" className="text-xs font-medium underline decoration-slate-300 underline-offset-2">Scorecards</Link>}>
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-line bg-slate-50/60"><tr><th className="th">Vendor</th><th className="th text-right">Score</th><th className="th text-right">On time</th><th className="th text-right">QC 1st pass</th><th className="th text-right">Open</th></tr></thead>
              <tbody className="divide-y divide-line">
                {league.map(({ v, s }) => (
                  <tr key={v.id}>
                    <td className="td"><Link href={`/vendors/${v.id}`} className="font-medium hover:underline">{v.name}</Link></td>
                    <td className="td tnum text-right"><span className={`font-semibold ${(s.score ?? 0) >= 85 ? "text-emerald-600" : (s.score ?? 0) >= 70 ? "text-amber-600" : "text-red-600"}`}>{s.score ?? "-"}</span></td>
                    <td className="td tnum text-right">{pct(s.onTimePct)}</td>
                    <td className="td tnum text-right">{pct(s.firstPassPct)}</td>
                    <td className="td tnum text-right">{usd(s.openValueUsd, true)}</td>
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

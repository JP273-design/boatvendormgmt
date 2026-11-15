import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, Empty, PageHeader } from "@/components/ui";
import { getSnapshot } from "@/lib/data";
import { pct, usd } from "@/lib/format";
import { requirePersona } from "@/lib/session";

function Meter({ label, value, target }: { label: string; value: number | null; target: number }) {
  const v = value ?? 0;
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="text-muted">{label}</span><span className="tnum font-medium">{pct(value)}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${v >= target ? "bg-emerald-500" : v >= target - 15 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export default async function VendorsPage() {
  const persona = await requirePersona();
  if (persona.role === "vendor") return <Empty>Not available for vendors.</Empty>;
  const snap = await getSnapshot();
  const rows = snap.vendors.map((v) => ({ v, s: snap.stats.get(v.id)! })).sort((a, b) => (b.s.score ?? 0) - (a.s.score ?? 0));

  return (
    <>
      <PageHeader title="Vendors" subtitle="Scored on the last 12 months: ready on time (50%), QC first-pass (35%), document accuracy (15%)" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ v, s }) => {
          const trend = s.recentOnTimePct !== null && s.onTimePct !== null ? s.recentOnTimePct - s.onTimePct : 0;
          return (
            <Link key={v.id} href={`/vendors/${v.id}`} className="block transition hover:-translate-y-0.5">
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{v.name}</div>
                    <div className="text-xs text-muted">{v.city} · {v.advancePct}% advance · {v.creditDays} days credit</div>
                  </div>
                  <div className={`tnum flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold ring-4 ${(s.score ?? 0) >= 85 ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : (s.score ?? 0) >= 70 ? "bg-amber-50 text-amber-700 ring-amber-100" : "bg-red-50 text-red-700 ring-red-100"}`}>{s.score ?? "-"}</div>
                </div>
                <div className="mt-4 space-y-3">
                  <Meter label="Ready on time" value={s.onTimePct} target={85} />
                  <Meter label="QC first-pass" value={s.firstPassPct} target={85} />
                  <Meter label="Document accuracy" value={s.docAccuracyPct} target={95} />
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
                  <span>{s.openPos} open · {usd(s.openValueUsd, true)}</span>
                  <span>{s.avgDelayDays !== null ? `${s.avgDelayDays.toFixed(1)} days late avg` : ""}</span>
                  {Math.abs(trend) >= 5 && (
                    <span className={`flex items-center gap-1 font-medium ${trend > 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {trend > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />} {trend > 0 ? "improving" : "slipping"}
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}

import Link from "next/link";
import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Empty, Milestones, PageHeader, PoLink, RiskBadge, StageBadge, Stat, TableWrap } from "@/components/ui";
import { getSnapshot, scopeViews } from "@/lib/data";
import { fmtDate, num, relDays, usd } from "@/lib/format";
import { requirePersona } from "@/lib/session";
import { nextAction } from "@/lib/tasks";
import { syncSap } from "../../actions";

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "mine", label: "Needs me" },
  { key: "risk", label: "At risk" },
  { key: "production", label: "Production" },
  { key: "qc", label: "QC" },
  { key: "shipping", label: "Shipping" },
  { key: "closed", label: "Closed" },
] as const;

export default async function PoListPage({ searchParams }: { searchParams: Promise<{ f?: string; vendor?: string; q?: string }> }) {
  const persona = await requirePersona();
  const sp = await searchParams;
  const snap = await getSnapshot();
  const all = scopeViews(snap, persona);
  const withAction = all.map((v) => ({ v, action: nextAction(v, persona, snap.now) }));
  const mineCount = withAction.filter((x) => x.action).length;
  const f = sp.f ?? (persona.role === "vendor" && mineCount ? "mine" : "open");
  const q = (sp.q ?? "").trim().toLowerCase();

  const rows = withAction.filter(({ v, action }) => {
    if (sp.vendor && v.vendor.id !== sp.vendor) return false;
    if (q && !`${v.po.poNumber} ${v.po.productName} ${v.vendor.name}`.toLowerCase().includes(q)) return false;
    const s = v.po.status;
    switch (f) {
      case "mine": return Boolean(action);
      case "risk": return v.risk.level !== "low";
      case "production": return s === "ISSUED" || s === "ACCEPTED" || s === "IN_PRODUCTION";
      case "qc": return s.startsWith("QC_");
      case "shipping": return s === "IN_TRANSIT";
      case "closed": return !v.open;
      default: return v.open;
    }
  });
  if (f === "risk" || f === "open") rows.sort((a, b) => b.v.risk.score - a.v.risk.score);

  const open = all.filter((v) => v.open);
  const isVendor = persona.role === "vendor";
  const href = (key: string) => `/pos?${new URLSearchParams({ f: key, ...(sp.vendor ? { vendor: sp.vendor } : {}), ...(q ? { q } : {}) })}`;

  return (
    <>
      <PageHeader
        title={isVendor ? "My orders" : persona.role === "procurement" ? "Control tower" : "Purchase orders"}
        subtitle={isVendor ? persona.title : "Every open PO, where it is, and whether it will be late"}
      >
        {["procurement", "csco", "ceo"].includes(persona.role) && (
          <ActionForm action={syncSap} submit={<><RefreshCw className="h-3.5 w-3.5" /> Sync from SAP</>} variant="plain" />
        )}
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open orders" value={open.length} sub={`${usd(open.reduce((a, v) => a + v.po.totalValueUsd, 0), true)} committed`} />
        <Stat label="Need your action" value={mineCount} tone={mineCount ? "amber" : undefined} sub={mineCount ? "See the Needs me tab" : "Nothing waiting on you"} />
        <Stat label="High risk" value={open.filter((v) => v.risk.level === "high").length} tone="red" sub={`${open.filter((v) => v.risk.level === "medium").length} more on watch`} />
        <Stat label="On the water" value={open.flatMap((v) => v.lots).filter((l) => l.status === "SHIPPED").length} sub="containers in transit" />
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((x) => (
              <Link key={x.key} href={href(x.key)} className={clsx("rounded-md px-2.5 py-1.5 text-xs font-medium transition", f === x.key ? "bg-navy text-white" : "text-muted hover:bg-slate-100 hover:text-ink")}>
                {x.label}
                {x.key === "mine" && mineCount > 0 && <span className="tnum ml-1 opacity-70">{mineCount}</span>}
              </Link>
            ))}
          </div>
          <form className="ml-auto flex items-center gap-2" action="/pos">
            <input type="hidden" name="f" value={f} />
            {!isVendor && (
              <select name="vendor" defaultValue={sp.vendor ?? ""} className="input w-auto py-1.5 text-xs" aria-label="Vendor">
                <option value="">All vendors</option>
                {snap.vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            )}
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search PO, product…" className="input w-40 py-1.5 text-xs" />
            <button className="btn btn-sm">Filter</button>
          </form>
        </div>

        {rows.length === 0 ? (
          <div className="p-4"><Empty>No orders match this view.</Empty></div>
        ) : (
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-line bg-slate-50/60">
                <tr>
                  <th className="th">PO</th>
                  <th className="th">Product</th>
                  {!isVendor && <th className="th">Vendor</th>}
                  <th className="th text-right">Qty</th>
                  <th className="th text-right">Value</th>
                  <th className="th">Stage</th>
                  <th className="th">Promised ready</th>
                  <th className="th">Risk</th>
                  <th className="th">Next step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ v, action }) => (
                  <tr key={v.po.id} className="hover:bg-slate-50/70">
                    <td className="td"><PoLink id={v.po.id} number={v.po.poNumber} /></td>
                    <td className="td whitespace-nowrap">{v.po.productName}</td>
                    {!isVendor && (
                      <td className="td">
                        <Link href={`/vendors/${v.vendor.id}`} className="hover:underline">{v.vendor.name.split(" ").slice(1, 2).join(" ")}</Link>
                        <span className="text-xs text-muted"> · {v.vendor.city}</span>
                      </td>
                    )}
                    <td className="td tnum text-right">{num(v.po.totalQty)}</td>
                    <td className="td tnum text-right">{usd(v.po.totalValueUsd, true)}</td>
                    <td className="td">
                      <StageBadge view={v} />
                      <div className="mt-1.5"><Milestones index={v.milestone} failed={v.po.status === "QC_FAILED"} /></div>
                    </td>
                    <td className="td whitespace-nowrap">
                      {v.po.promisedReadyDate ? (
                        <>
                          {fmtDate(v.po.promisedReadyDate)}
                          {!v.po.qcPassedAt && <div className="text-xs text-muted">{relDays(v.po.promisedReadyDate, snap.now)}</div>}
                        </>
                      ) : (
                        <span className="text-xs text-muted">Not confirmed</span>
                      )}
                    </td>
                    <td className="td">
                      <RiskBadge risk={v.risk} />
                      {v.risk.projectedDelayDays > 0 && v.risk.level !== "low" && <div className="mt-1 text-xs text-muted">~{v.risk.projectedDelayDays} days late</div>}
                    </td>
                    <td className="td">{action ? <Link href={`/pos/${v.po.id}`}><Badge tone="amber">{action} →</Badge></Link> : <span className="text-xs text-slate-300">-</span>}</td>
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

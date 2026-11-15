import { LogisticsActions } from "@/components/lot-forms";
import { Badge, Card, Empty, PageHeader, PoLink, Stat } from "@/components/ui";
import type { LotStatus } from "@/db/schema";
import { getSnapshot, scopeViews } from "@/lib/data";
import { DAY, fmtDate, num, relDays, usd } from "@/lib/format";
import { requirePersona } from "@/lib/session";

const COLUMNS: { status: LotStatus; title: string; hint: string }[] = [
  { status: "CREATED", title: "Awaiting shipment", hint: "Lot created, no container yet" },
  { status: "SHIPPED", title: "On the water", hint: "Sailing to India" },
  { status: "AT_PORT", title: "At port", hint: "Customs clearance in progress" },
  { status: "CUSTOMS_CLEARED", title: "Cleared", hint: "Ready for pickup" },
  { status: "PICKED_UP", title: "To warehouse", hint: "On the road, GRN pending" },
];

export default async function ShipmentsPage() {
  const persona = await requirePersona();
  const snap = await getSnapshot();
  const now = snap.now.getTime();
  const lots = scopeViews(snap, persona).flatMap((v) => v.lots.filter((l) => l.status !== "RECEIVED").map((l) => ({ l, v, value: (l.qty / v.po.totalQty) * v.po.totalValueUsd })));
  const isLogistics = persona.role === "logistics";
  const stuck = lots.filter(({ l }) => l.status === "AT_PORT" && l.arrivedAt && now - l.arrivedAt.getTime() > 4 * DAY);
  const arriving = lots.filter(({ l }) => l.status === "SHIPPED" && l.eta && l.eta.getTime() - now < 7 * DAY);

  return (
    <>
      <PageHeader title="Shipments" subtitle="Every lot between the factory gate and the warehouse dock" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lots in motion" value={lots.length} sub={`${usd(lots.reduce((a, x) => a + x.value, 0), true)} of goods`} />
        <Stat label="On the water" value={lots.filter((x) => x.l.status === "SHIPPED").length} sub="containers" />
        <Stat label="Arriving within 7 days" value={arriving.length} sub="plan customs paperwork" />
        <Stat label="Stuck at port > 4 days" value={stuck.length} tone={stuck.length ? "red" : undefined} sub={stuck.length ? "demurrage accruing" : "none"} />
      </div>

      {lots.length === 0 && <Empty>No lots in transit.</Empty>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {COLUMNS.map((col) => {
          const items = lots.filter((x) => x.l.status === col.status).sort((a, b) => (a.l.eta?.getTime() ?? 0) - (b.l.eta?.getTime() ?? 0));
          return (
            <div key={col.status}>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h2 className="text-sm font-semibold">{col.title} <span className="tnum font-normal text-muted">{items.length}</span></h2>
              </div>
              <div className="space-y-3">
                {items.length === 0 && <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-muted">{col.hint}</div>}
                {items.map(({ l, v, value }) => {
                  const daysAtPort = l.arrivedAt ? Math.floor((now - l.arrivedAt.getTime()) / DAY) : 0;
                  const slip = l.eta && l.originalEta ? Math.round((l.eta.getTime() - l.originalEta.getTime()) / DAY) : 0;
                  return (
                    <Card key={l.id} className={l.status === "AT_PORT" && daysAtPort > 4 ? "border-red-300" : ""}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-[13px] font-medium">{l.lotNumber}</span>
                        <span className="tnum text-xs text-muted">{usd(value, true)}</span>
                      </div>
                      <div className="mt-1 text-sm">{v.po.productName}</div>
                      <div className="text-xs text-muted">{num(l.qty)} units · {v.vendor.name.split(" ").slice(1, 2).join(" ")} · <PoLink id={v.po.id} number={v.po.poNumber} /></div>
                      {l.containerNo && (
                        <div className="mt-2.5 space-y-0.5 border-t border-line pt-2.5 text-xs">
                          <div className="font-mono">{l.containerNo}</div>
                          <div className="text-muted">{l.vessel} · {l.carrier}</div>
                          <div className="text-muted">{l.portOfLoading} → {l.portOfDischarge}</div>
                          {l.status === "SHIPPED" && l.eta && (
                            <div className="pt-1">
                              ETA <span className="font-medium">{fmtDate(l.eta)}</span> <span className="text-muted">({relDays(l.eta, snap.now)})</span>
                              {slip > 0 && <Badge tone="amber" className="ml-1.5">+{slip}d</Badge>}
                            </div>
                          )}
                          {l.status === "AT_PORT" && <div className="pt-1"><Badge tone={daysAtPort > 4 ? "red" : "amber"}>{daysAtPort} days at port</Badge></div>}
                          {l.status === "CUSTOMS_CLEARED" && l.clearedAt && <div className="pt-1 text-muted">Cleared {relDays(l.clearedAt, snap.now)}</div>}
                          {l.status === "PICKED_UP" && l.pickedUpAt && <div className="pt-1 text-muted">Picked up {relDays(l.pickedUpAt, snap.now)}</div>}
                        </div>
                      )}
                      {isLogistics && ["SHIPPED", "AT_PORT", "CUSTOMS_CLEARED"].includes(l.status) && (
                        <div className="mt-3 border-t border-line pt-3 [&>div>div:first-child]:hidden"><LogisticsActions lot={l} /></div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

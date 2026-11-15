import { AlertTriangle, Clock } from "lucide-react";
import { Badge, Card, Empty, PageHeader, PoLink } from "@/components/ui";
import { getSnapshot, scopeAlerts, type Alert } from "@/lib/data";
import { ROLE_LABEL } from "@/lib/personas";
import { requirePersona } from "@/lib/session";

function List({ items }: { items: Alert[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{a.title}</span>
              <Badge>{a.kind}</Badge>
            </div>
            <div className="mt-0.5 text-sm text-slate-600">{a.detail}</div>
            <div className="mt-1 text-xs text-muted">
              <PoLink id={a.poId} number={a.poNumber} /> · {a.vendorName} · owner: {a.owners.map((o) => ROLE_LABEL[o]).join(", ")}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function AlertsPage() {
  const persona = await requirePersona();
  const snap = await getSnapshot();
  const alerts = scopeAlerts(snap, persona);
  const high = alerts.filter((a) => a.severity === "high");
  const medium = alerts.filter((a) => a.severity === "medium");

  return (
    <>
      <PageHeader title="Alerts" subtitle="Exceptions the system has found - recalculated from live data every time you open this page" />
      {alerts.length === 0 && <Empty>Nothing needs attention right now.</Empty>}
      <div className="space-y-4">
        {high.length > 0 && (
          <Card pad={false} title={<span className="flex items-center gap-2 text-red-700"><AlertTriangle className="h-4 w-4" /> Act now · {high.length}</span>}>
            <List items={high} />
          </Card>
        )}
        {medium.length > 0 && (
          <Card pad={false} title={<span className="flex items-center gap-2 text-amber-700"><Clock className="h-4 w-4" /> Watch · {medium.length}</span>}>
            <List items={medium} />
          </Card>
        )}
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { InspectionForm } from "@/components/inspection-form";
import { Badge, Card } from "@/components/ui";
import { getSnapshot, getTemplates, scopeViews } from "@/lib/data";
import { fmtDate, num } from "@/lib/format";
import { requirePersona } from "@/lib/session";

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const persona = await requirePersona();
  const snap = await getSnapshot();
  const v = scopeViews(snap, persona).find((x) => x.inspections.some((q) => q.id === id));
  const q = v?.inspections.find((x) => x.id === id);
  if (!v || !q) notFound();
  const template = (await getTemplates()).find((t) => t.id === q.templateId);
  if (!template) notFound();
  const editable = persona.role === "qc" && q.status === "SCHEDULED";
  const previous = v.inspections.find((x) => x.attempt === q.attempt - 1);
  const previousFails = previous?.results.filter((r) => r.result === "fail") ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 text-xs text-muted">
        <Link href="/qc" className="hover:underline">Inspections</Link> / <Link href={`/pos/${v.po.id}`} className="font-mono hover:underline">{v.po.poNumber}</Link>
      </div>
      <h1 className="text-xl font-semibold tracking-tight">{v.po.productName}</h1>
      <p className="mt-1 text-sm text-muted">{v.vendor.name} · {v.vendor.city}</p>

      <Card className="my-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Badge tone={q.status === "PASSED" ? "green" : q.status === "FAILED" ? "red" : "violet"}>{q.status === "SCHEDULED" ? `Scheduled ${fmtDate(q.scheduledFor)}` : q.status === "REQUESTED" ? "Not scheduled yet" : q.status === "PASSED" ? "Passed" : "Failed"}</Badge>
          <span><span className="text-muted">Lot size</span> {num(v.po.totalQty)}</span>
          <span><span className="text-muted">Sample (AQL II)</span> {q.sampleSize}</span>
          <span><span className="text-muted">Inspector</span> {q.inspectorName ?? "-"}</span>
          <span><span className="text-muted">Checklist</span> {template.name}</span>
        </div>
        {q.summary && <p className="mt-3 text-sm text-slate-700">{q.summary}</p>}
        {editable && previousFails.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <div className="font-medium">Re-inspection - verify these were fixed:</div>
            <ul className="mt-1 list-disc pl-5">
              {previousFails.map((r) => (
                <li key={r.itemId}>{template.items.find((i) => i.id === r.itemId)?.check}{r.note ? ` - ${r.note}` : ""}</li>
              ))}
            </ul>
          </div>
        )}
        {!editable && q.status === "SCHEDULED" && <p className="mt-3 text-xs text-muted">Only the QC inspector can fill and sign off this checklist.</p>}
      </Card>

      <InspectionForm inspectionId={q.id} items={template.items} initial={q.results} editable={editable} poId={v.po.id} />
    </div>
  );
}

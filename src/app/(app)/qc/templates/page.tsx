import { Sparkles } from "lucide-react";
import { TemplateEditor } from "@/components/template-editor";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getTemplates } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { requirePersona } from "@/lib/session";

export default async function TemplatesPage() {
  const persona = await requirePersona();
  const templates = await getTemplates();
  const canEdit = persona.role === "procurement" || persona.role === "csco";
  // the newest approved checklist per category is the one new QC requests use
  const live = new Set(["speaker", "soundbar"].map((c) => templates.find((t) => t.category === c && t.approved)?.id));

  return (
    <>
      <PageHeader title="QC checklists" subtitle="What the inspector checks at the factory, per product category" />
      {canEdit && (
        <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand" /> New checklist</span>} className="mb-4">
          <TemplateEditor />
        </Card>
      )}
      <div className="space-y-4">
        {templates.map((t) => (
          <Card
            key={t.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {t.name}
                {live.has(t.id) ? <Badge tone="green">In use</Badge> : t.approved ? <Badge>Superseded</Badge> : <Badge tone="amber">Draft</Badge>}
                {t.aiDrafted && <Badge tone="violet">AI drafted</Badge>}
              </span>
            }
            action={<span className="text-xs text-muted">{t.items.length} checks · updated {fmtDate(t.updatedAt, true)}</span>}
            pad={false}
          >
            <details open={live.has(t.id) && templates.length <= 2}>
              <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-muted hover:text-ink">Show checks</summary>
              <table className="w-full border-t border-line">
                <tbody className="divide-y divide-line">
                  {t.items.map((i) => (
                    <tr key={i.id}>
                      <td className="td w-44 text-xs text-muted">{i.section}</td>
                      <td className="td">{i.check}{i.critical && <Badge tone="red" className="ml-2">Critical</Badge>}</td>
                      <td className="td hidden text-xs text-muted sm:table-cell">{i.method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}

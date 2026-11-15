import { asc } from "drizzle-orm";
import { ArrowRight, Factory, RotateCcw } from "lucide-react";
import { db, schema } from "@/db";
import { ActionForm } from "@/components/action-form";
import { STAFF, type Persona } from "@/lib/personas";
import { login, resetDemo } from "./actions";

export const dynamic = "force-dynamic";

const BLURB: Record<string, string> = {
  ceo: "Open exposure, at-risk orders and the AI daily brief",
  csco: "End-to-end supply view, vendor league table, exceptions",
  procurement: "Control tower - chase vendors, schedule QC, own checklists",
  qc: "Factory inspections on a phone - checklist, photos, sign-off",
  logistics: "Containers at sea, at port, customs and pickup",
  warehouse: "Receive lots and post GRN to SAP",
  finance: "Payments due per terms, 3-way match, holds",
};

function PersonaButton({ p, blurb }: { p: Persona; blurb: string }) {
  return (
    <form action={login}>
      <input type="hidden" name="persona" value={p.id} />
      <button className="group flex w-full items-center gap-3 rounded-xl border border-line bg-white p-3.5 text-left shadow-sm transition hover:border-slate-400 hover:shadow">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white">
          {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{p.name}</span>
          <span className="block truncate text-xs text-muted">{p.title}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{blurb}</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-ink" />
      </button>
    </form>
  );
}

export default async function LoginPage() {
  const vendors = await db.select().from(schema.vendors).orderBy(asc(schema.vendors.name));
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:py-16">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-white">
          <Factory className="h-4 w-4" />
        </span>
        Vendor Control Tower
      </div>
      <h1 className="mt-6 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">From PO to payment, on one screen.</h1>
      <p className="mt-3 max-w-2xl text-muted">
        SAP purchase order → vendor lead time → QC → lot and container → India port → warehouse GRN → payment. Pick a seat at the table to see the
        workflow from that role.
      </p>

      <h2 className="mt-10 text-xs font-semibold uppercase tracking-wider text-muted">boAt team</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STAFF.map((p) => (
          <PersonaButton key={p.id} p={p} blurb={BLURB[p.id]} />
        ))}
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-muted">Vendors in China</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {vendors.map((v) => (
          <PersonaButton key={v.id} p={{ id: `vendor:${v.id}`, role: "vendor", name: v.contactName, title: v.name }} blurb={`Vendor portal - ${v.city}`} />
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-line pt-5 text-xs text-muted">
        <span>Demo environment - sample data, SAP is simulated.</span>
        <ActionForm action={resetDemo} submit={<><RotateCcw className="h-3.5 w-3.5" /> Reset demo data</>} variant="plain" small confirm="Reset all demo data to its starting state?" />
      </div>
    </main>
  );
}

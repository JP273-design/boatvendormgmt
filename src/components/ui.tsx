import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import type { PoStatus } from "@/db/schema";
import type { PoView } from "@/lib/data";
import { MILESTONES } from "@/lib/format";
import type { Risk } from "@/lib/risk";

type Tone = "gray" | "blue" | "green" | "amber" | "red" | "violet";

const TONE: Record<Tone, string> = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
};

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONE[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<PoStatus, Tone> = {
  ISSUED: "gray",
  ACCEPTED: "blue",
  IN_PRODUCTION: "blue",
  QC_REQUESTED: "violet",
  QC_SCHEDULED: "violet",
  QC_FAILED: "red",
  QC_PASSED: "green",
  IN_TRANSIT: "amber",
  CLOSED: "green",
  PAID: "gray",
};

export function StageBadge({ view }: { view: Pick<PoView, "po" | "stage"> }) {
  return <Badge tone={STATUS_TONE[view.po.status]}>{view.stage}</Badge>;
}

export function RiskBadge({ risk, showScore = true }: { risk: Risk; showScore?: boolean }) {
  if (risk.level === "low") return <span className="text-xs text-slate-400">On track</span>;
  return (
    <Badge tone={risk.level === "high" ? "red" : "amber"}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", risk.level === "high" ? "bg-red-500" : "bg-amber-500")} />
      {risk.level === "high" ? "High risk" : "Watch"}
      {showScore && <span className="tnum opacity-70">{risk.score}</span>}
    </Badge>
  );
}

export function Card({ title, action, children, className, pad = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx("rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "red" | "amber" | "green" }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={clsx("tnum mt-1 text-2xl font-semibold tracking-tight", tone === "red" && "text-red-600", tone === "amber" && "text-amber-600", tone === "green" && "text-emerald-600")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** 8-step progress bar shared by lists and the PO page. */
export function Milestones({ index, failed, labels = false }: { index: number; failed?: boolean; labels?: boolean }) {
  return (
    <div className={labels ? "w-full" : "w-28"}>
      <div className="flex gap-1">
        {MILESTONES.map((m, i) => (
          <div key={m} className="flex-1">
            <div
              title={m}
              className={clsx("h-1.5 rounded-full", i < index ? "bg-emerald-500" : i === index ? (failed ? "bg-red-500" : "bg-navy") : "bg-slate-200")}
            />
            {labels && (
              <div className={clsx("mt-1.5 hidden text-[11px] sm:block", i === index ? "font-semibold text-ink" : i < index ? "text-emerald-700" : "text-slate-400")}>{m}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</div>;
}

export function PoLink({ id, number }: { id: string; number: string }) {
  return (
    <Link href={`/pos/${id}`} className="tnum font-mono text-[13px] font-medium text-ink underline decoration-slate-300 underline-offset-2 hover:decoration-ink">
      {number}
    </Link>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

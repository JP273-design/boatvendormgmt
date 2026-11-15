import Link from "next/link";
import { Factory, LogOut } from "lucide-react";
import { Assistant } from "@/components/assistant";
import { NavLinks } from "@/components/nav";
import { getSnapshot, scopeAlerts } from "@/lib/data";
import { HOME, NAV, ROLE_LABEL, type Role } from "@/lib/personas";
import { requirePersona } from "@/lib/session";
import { logout } from "../actions";

export const dynamic = "force-dynamic";

const SUGGESTIONS: Record<Role, string[]> = {
  ceo: ["What should I worry about this week ?", "Which vendor is hurting us most, and what does it cost ?", "How much cash goes out to vendors in the next 30 days ?"],
  csco: ["Which POs will miss their promised date ?", "Compare vendors on on-time delivery and QC first-pass", "What is stuck at Indian ports right now ?"],
  procurement: ["Which QC requests are waiting on me ?", "Which POs from Dongguan are behind plan ?", "What keeps failing QC at BrightSound ?"],
  vendor: ["Which of my orders need action today ?", "When will I be paid for my closed orders ?", "Why did my last QC fail ?"],
  qc: ["Which inspections are scheduled this week ?", "What defects has BrightSound had before ?", "Which checks fail most often on soundbars ?"],
  logistics: ["Which containers arrive in the next 7 days ?", "What is stuck at port and for how long ?", "Which ETAs have slipped ?"],
  warehouse: ["What is arriving at the warehouse this week ?", "Which lots are picked up but not yet received ?", "Any lots with damage on past GRNs ?"],
  finance: ["What payments fall due in the next 14 days ?", "Which payments are on hold and why ?", "Total payable by vendor"],
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const persona = await requirePersona();
  const snap = await getSnapshot();
  const alertCount = scopeAlerts(snap, persona).filter((a) => a.severity === "high").length;
  const items = NAV[persona.role];

  const brand = (
    <Link href={HOME[persona.role]} className="flex items-center gap-2 text-sm font-semibold text-white">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand">
        <Factory className="h-4 w-4" />
      </span>
      Vendor Control Tower
    </Link>
  );

  const who = (
    <form action={logout} className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
        {persona.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">{persona.name}</span>
        <span className="block truncate text-[11px] text-slate-400">{persona.role === "vendor" ? persona.title : ROLE_LABEL[persona.role]}</span>
      </span>
      <button title="Switch persona" aria-label="Switch persona" className="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white">
        <LogOut className="h-4 w-4" />
      </button>
    </form>
  );

  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-navy p-3 lg:flex">
        <div className="px-2 py-3">{brand}</div>
        <div className="mt-3 flex-1">
          <NavLinks items={items} alertCount={alertCount} layout="side" />
        </div>
        <div className="border-t border-white/10 px-1 pt-3">{who}</div>
      </aside>

      <header className="sticky top-0 z-30 bg-navy lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          {brand}
          <div className="max-w-[55%]">{who}</div>
        </div>
        <NavLinks items={items} alertCount={alertCount} layout="top" />
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7">{children}</main>
      <Assistant suggestions={SUGGESTIONS[persona.role]} name={persona.name} />
    </div>
  );
}

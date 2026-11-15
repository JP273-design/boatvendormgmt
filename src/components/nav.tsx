"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Bell, ClipboardCheck, Factory, FileText, Gauge, ListChecks, Ship, Wallet, Warehouse } from "lucide-react";
import type { NavItem } from "@/lib/personas";

const ICONS = { gauge: Gauge, file: FileText, bell: Bell, check: ClipboardCheck, list: ListChecks, factory: Factory, ship: Ship, warehouse: Warehouse, wallet: Wallet } as const;

export function NavLinks({ items, alertCount, layout }: { items: NavItem[]; alertCount: number; layout: "side" | "top" }) {
  const path = usePathname() ?? "";
  // longest matching href wins, so /qc/templates does not also light up /qc
  const active = items.filter((i) => path === i.href || path.startsWith(`${i.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className={layout === "side" ? "flex flex-col gap-0.5" : "flex gap-1 overflow-x-auto px-3 pb-2"}>
      {items.map((item) => {
        const Icon = ICONS[item.icon as keyof typeof ICONS];
        const on = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "flex shrink-0 items-center gap-2.5 rounded-lg text-sm font-medium transition",
              layout === "side" ? "px-3 py-2" : "px-3 py-1.5",
              on ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="whitespace-nowrap">{item.label}</span>
            {item.href === "/alerts" && alertCount > 0 && (
              <span className="tnum ml-auto rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">{alertCount}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

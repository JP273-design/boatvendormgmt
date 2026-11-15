import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getPoEvents, getTemplates, scopeAlerts, scopeViews, type PoView, type Snapshot } from "./data";
import { fmtDate, LOT_STAGE_LABEL } from "./format";
import type { Persona } from "./personas";

/**
 * Typed, read-only tools the assistant can call. Everything is scoped to the
 * persona first, so a vendor's assistant can never see another vendor's data.
 */

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_purchase_orders",
    description: "List purchase orders with stage, risk and key dates. Use filters to narrow down. Returns at most 40 rows plus totals.",
    input_schema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["open", "closed", "all"], description: "open = not yet closed in SAP (default)" },
        status: { type: "string", enum: ["ISSUED", "ACCEPTED", "IN_PRODUCTION", "QC_REQUESTED", "QC_SCHEDULED", "QC_FAILED", "QC_PASSED", "IN_TRANSIT", "CLOSED", "PAID"] },
        vendor: { type: "string", description: "Part of the vendor name or city, e.g. 'Harmony' or 'Shenzhen'" },
        risk: { type: "string", enum: ["high", "medium", "low"] },
        product: { type: "string", description: "Part of the product name, e.g. 'Aavante'" },
      },
    },
  },
  {
    name: "get_purchase_order",
    description: "Full detail of one PO: lines, promised dates, production, QC inspections with failed checks, lots and containers, documents, payments, risk factors and recent timeline.",
    input_schema: { type: "object", properties: { po_number: { type: "string" } }, required: ["po_number"] },
  },
  {
    name: "vendor_scorecards",
    description: "12-month performance for each vendor: on-time %, average days late, QC first-pass %, document accuracy, open orders and value, payment terms.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_shipments",
    description: "Lots and containers: status, container number, vessel, ports, ETD/ETA, days at port.",
    input_schema: {
      type: "object",
      properties: { status: { type: "string", enum: ["CREATED", "SHIPPED", "AT_PORT", "CUSTOMS_CLEARED", "PICKED_UP", "RECEIVED"] }, include_received: { type: "boolean" } },
    },
  },
  {
    name: "list_alerts",
    description: "Current exceptions: delay risks, document mismatches, payments due, overdue or on hold.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_payments",
    description: "Payments by status with due dates. Use for cash-out forecasts and what finance must release.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["pending", "on_hold", "paid"] }, due_within_days: { type: "number" } } },
  },
  {
    name: "qc_defects",
    description: "Which QC checks failed, how often, by vendor - for defect pattern questions.",
    input_schema: { type: "object", properties: { vendor: { type: "string" } } },
  },
];

const has = (hay: string, needle?: string) => !needle || hay.toLowerCase().includes(needle.toLowerCase());

const row = (v: PoView) => ({
  po: v.po.poNumber,
  vendor: v.vendor.name,
  product: v.po.productName,
  qty: v.po.totalQty,
  valueUsd: v.po.totalValueUsd,
  stage: v.stage,
  status: v.po.status,
  issued: fmtDate(v.po.issuedAt, true),
  promisedReady: v.po.promisedReadyDate ? fmtDate(v.po.promisedReadyDate, true) : null,
  productionPct: v.po.status === "IN_PRODUCTION" ? v.po.productionPct : undefined,
  risk: v.risk.level,
  riskScore: v.risk.score,
  topRisk: v.risk.factors[0]?.detail,
});

export async function runAssistantTool(name: string, input: Record<string, unknown>, snap: Snapshot, persona: Persona): Promise<unknown> {
  const views = scopeViews(snap, persona);
  const i = input as Record<string, string | number | boolean | undefined>;

  switch (name) {
    case "list_purchase_orders": {
      const scope = (i.scope as string) ?? (i.status ? "all" : "open");
      const list = views.filter(
        (v) =>
          (scope === "all" || (scope === "open" ? v.open : !v.open)) &&
          (!i.status || v.po.status === i.status) &&
          (!i.risk || v.risk.level === i.risk) &&
          has(`${v.vendor.name} ${v.vendor.city}`, i.vendor as string) &&
          has(v.po.productName, i.product as string),
      );
      return { count: list.length, totalValueUsd: Math.round(list.reduce((a, v) => a + v.po.totalValueUsd, 0)), rows: list.slice(0, 40).map(row) };
    }
    case "get_purchase_order": {
      const v = views.find((x) => x.po.poNumber === String(i.po_number).trim());
      if (!v) return { error: `No PO ${i.po_number} visible to this user` };
      const templates = await getTemplates();
      const events = await getPoEvents(v.po.id);
      return {
        ...row(v),
        lines: v.po.lines,
        requestedLeadDays: v.po.requestedLeadDays,
        promisedLeadDays: v.po.promisedLeadDays,
        paymentTerms: `${v.vendor.advancePct}% advance, balance ${v.vendor.creditDays} days after GRN`,
        projectedDelayDays: v.risk.projectedDelayDays,
        riskFactors: v.risk.factors,
        inspections: v.inspections.map((q) => {
          const items = templates.find((t) => t.id === q.templateId)?.items ?? [];
          return {
            attempt: q.attempt, status: q.status, scheduledFor: fmtDate(q.scheduledFor), inspector: q.inspectorName, summary: q.summary,
            failedChecks: q.results.filter((r) => r.result === "fail").map((r) => ({ check: items.find((it) => it.id === r.itemId)?.check, note: r.note })),
          };
        }),
        lots: v.lots.map((l) => ({ lot: l.lotNumber, qty: l.qty, status: LOT_STAGE_LABEL[l.status], container: l.containerNo, vessel: l.vessel, from: l.portOfLoading, to: l.portOfDischarge, etd: fmtDate(l.etd), eta: fmtDate(l.eta), originalEta: fmtDate(l.originalEta), arrived: fmtDate(l.arrivedAt), received: fmtDate(l.receivedAt) })),
        goodsReceipts: v.grns.map((g) => ({ grn: g.grnNumber, received: g.receivedQty, damaged: g.damagedQty, short: g.shortQty, note: g.note })),
        documents: v.docs.map((d) => ({ file: d.fileName, type: d.type, match: d.matchStatus, issues: d.issues })),
        payments: v.payments.map((p) => ({ milestone: p.milestone, amountUsd: p.amountUsd, due: fmtDate(p.dueDate, true), status: p.status, holdReason: p.holdReason })),
        timeline: events.slice(0, 12).map((e) => `${fmtDate(e.at)} - ${e.actorName}: ${e.message}`),
      };
    }
    case "vendor_scorecards":
      return snap.vendors
        .filter((v) => persona.role !== "vendor" || v.id === persona.vendorId)
        .map((v) => {
          const s = snap.stats.get(v.id)!;
          const r = (n: number | null) => (n === null ? null : Math.round(n));
          return { vendor: v.name, city: v.city, score: s.score, completedOrders: s.completed, onTimePct: r(s.onTimePct), recentOnTimePct: r(s.recentOnTimePct), avgDaysLate: s.avgDelayDays?.toFixed(1), qcFirstPassPct: r(s.firstPassPct), docAccuracyPct: r(s.docAccuracyPct), openPos: s.openPos, openValueUsd: Math.round(s.openValueUsd), terms: `${v.advancePct}% advance, ${v.creditDays} days credit` };
        });
    case "list_shipments": {
      const now = snap.now.getTime();
      return views
        .flatMap((v) => v.lots.map((l) => ({ v, l })))
        .filter(({ l }) => (i.status ? l.status === i.status : i.include_received || l.status !== "RECEIVED"))
        .slice(0, 60)
        .map(({ v, l }) => ({
          lot: l.lotNumber, po: v.po.poNumber, vendor: v.vendor.name, product: v.po.productName, qty: l.qty, valueUsd: Math.round((l.qty / v.po.totalQty) * v.po.totalValueUsd),
          status: LOT_STAGE_LABEL[l.status], container: l.containerNo, carrier: l.carrier, vessel: l.vessel, from: l.portOfLoading, to: l.portOfDischarge,
          etd: fmtDate(l.etd), eta: fmtDate(l.eta), etaSlipDays: l.eta && l.originalEta ? Math.round((l.eta.getTime() - l.originalEta.getTime()) / 86_400_000) : 0,
          daysAtPort: l.status === "AT_PORT" && l.arrivedAt ? Math.floor((now - l.arrivedAt.getTime()) / 86_400_000) : undefined,
        }));
    }
    case "list_alerts":
      return scopeAlerts(snap, persona).map((a) => ({ severity: a.severity, kind: a.kind, po: a.poNumber, vendor: a.vendorName, title: a.title, detail: a.detail }));
    case "list_payments": {
      const now = snap.now.getTime();
      const within = typeof i.due_within_days === "number" ? i.due_within_days : null;
      const list = views
        .flatMap((v) => v.payments.map((p) => ({ v, p })))
        .filter(({ p }) => (i.status ? p.status === i.status : p.status !== "paid") && (within === null || p.dueDate.getTime() - now <= within * 86_400_000));
      return {
        count: list.length,
        totalUsd: Math.round(list.reduce((a, x) => a + x.p.amountUsd, 0)),
        rows: list.slice(0, 50).map(({ v, p }) => ({ po: v.po.poNumber, vendor: v.vendor.name, milestone: p.milestone, amountUsd: p.amountUsd, due: fmtDate(p.dueDate, true), daysToDue: Math.round((p.dueDate.getTime() - now) / 86_400_000), status: p.status, holdReason: p.holdReason })),
      };
    }
    case "qc_defects": {
      const templates = await getTemplates();
      const counts = new Map<string, { vendor: string; check: string; fails: number; example?: string }>();
      for (const v of views) {
        if (!has(v.vendor.name, i.vendor as string)) continue;
        for (const q of v.inspections) {
          const items = templates.find((t) => t.id === q.templateId)?.items ?? [];
          for (const r of q.results) {
            if (r.result !== "fail") continue;
            const check = items.find((it) => it.id === r.itemId)?.check ?? r.itemId;
            const key = `${v.vendor.id}|${check}`;
            const c = counts.get(key) ?? { vendor: v.vendor.name, check, fails: 0, example: r.note };
            c.fails++;
            counts.set(key, c);
          }
        }
      }
      return [...counts.values()].sort((a, b) => b.fails - a.fails).slice(0, 30);
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

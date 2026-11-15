"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { seed } from "@/db/seed";
import type { ChecklistItem, ChecklistResult } from "@/db/schema";
import type { ActionState } from "@/components/action-form";
import { aiErrorMessage, draftChecklist, extractDocument, generateText, type DocType } from "@/lib/ai";
import { getSnapshot, getTemplates, scopeAlerts, scopeViews } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { HOME, STAFF, type Persona } from "@/lib/personas";
import { COOKIE, requirePersona } from "@/lib/session";
import { storeFile } from "@/lib/storage";
import * as wf from "@/lib/workflow";

/** Run a workflow step as the current persona; turn rule violations into inline form errors. */
async function run(fn: (p: Persona) => Promise<string | void>): Promise<ActionState> {
  const p = await requirePersona();
  try {
    const msg = await fn(p);
    revalidatePath("/", "layout");
    return { ok: msg ?? "Done" };
  } catch (e) {
    if (e instanceof wf.WorkflowError) return { error: e.message };
    const ai = aiErrorMessage(e);
    if (ai) return { error: ai };
    throw e;
  }
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const int = (f: FormData, k: string) => (str(f, k) === "" ? NaN : Number(str(f, k)));
/** <input type="date"> value → noon IST, so the date reads the same in India and China. */
const date = (f: FormData, k: string) => new Date(`${str(f, k)}T12:00:00+05:30`);

// ---------------------------------------------------------------- session

export async function login(form: FormData) {
  const id = str(form, "persona");
  const role = STAFF.find((s) => s.id === id)?.role ?? (id.startsWith("vendor:") ? "vendor" : null);
  if (!role) redirect("/");
  (await cookies()).set(COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect(HOME[role]);
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/");
}

export async function resetDemo(_: ActionState, _form: FormData): Promise<ActionState> {
  await seed(db);
  revalidatePath("/", "layout");
  return { ok: "Demo data reset" };
}

export async function syncSap(_: ActionState, _form: FormData) {
  return run(async (p) => {
    const ids = await wf.syncFromSap(p);
    return `${ids.length} new PO pulled from SAP`;
  });
}

// ---------------------------------------------------------------- workflow steps

export async function acceptPo(_: ActionState, f: FormData) {
  return run((p) => wf.acceptPo(p, str(f, "poId"), int(f, "leadDays")).then(() => "Order accepted"));
}

export async function updateProduction(_: ActionState, f: FormData) {
  return run((p) => wf.updateProduction(p, str(f, "poId"), int(f, "pct")).then(() => "Progress updated"));
}

export async function requestQc(_: ActionState, f: FormData) {
  return run((p) => wf.requestQc(p, str(f, "poId")).then(() => "QC requested"));
}

export async function scheduleQc(_: ActionState, f: FormData) {
  return run((p) => wf.scheduleQc(p, str(f, "inspectionId"), date(f, "date"), str(f, "inspector")).then(() => "Inspection scheduled"));
}

export async function submitInspection(inspectionId: string, results: ChecklistResult[], notes: string): Promise<ActionState & { passed?: boolean; poId?: string }> {
  let out: { passed: boolean; poId: string } | undefined;
  const state = await run(async (p) => {
    out = await wf.submitInspection(p, inspectionId, results, notes);
    return out.passed ? "Inspection passed" : "Inspection failed - vendor notified";
  });
  return { ...state, ...out };
}

export async function createLot(_: ActionState, f: FormData) {
  return run((p) => wf.createLot(p, str(f, "poId"), int(f, "qty"), int(f, "cartons")).then(() => "Lot created"));
}

export async function shipLot(_: ActionState, f: FormData) {
  return run((p) =>
    wf
      .shipLot(p, str(f, "lotId"), {
        containerNo: str(f, "containerNo"), blNo: str(f, "blNo"), carrier: str(f, "carrier"), vessel: str(f, "vessel"),
        portOfLoading: str(f, "portOfLoading"), portOfDischarge: str(f, "portOfDischarge"), etd: date(f, "etd"), eta: date(f, "eta"),
      })
      .then(() => "Shipping details saved"),
  );
}

export async function updateEta(_: ActionState, f: FormData) {
  return run((p) => wf.updateEta(p, str(f, "lotId"), date(f, "eta")).then(() => "ETA updated"));
}

export async function advanceLot(_: ActionState, f: FormData) {
  return run((p) => wf.advanceLot(p, str(f, "lotId"), str(f, "to") as "AT_PORT" | "CUSTOMS_CLEARED" | "PICKED_UP").then(() => "Updated"));
}

export async function receiveLot(_: ActionState, f: FormData) {
  return run(async (p) => {
    const r = await wf.receiveLot(p, str(f, "lotId"), int(f, "receivedQty"), int(f, "damagedQty") || 0, str(f, "note"));
    return r.closed ? `GRN ${r.grnNumber} posted - PO closed in SAP` : `GRN ${r.grnNumber} posted to SAP`;
  });
}

export async function releasePayment(_: ActionState, f: FormData) {
  return run((p) => wf.releasePayment(p, str(f, "paymentId")).then(() => "Payment released"));
}

export async function setPaymentHold(_: ActionState, f: FormData) {
  const hold = str(f, "hold") === "1";
  return run((p) => wf.setPaymentHold(p, str(f, "paymentId"), hold, str(f, "reason")).then(() => (hold ? "Payment on hold" : "Hold cleared")));
}

export async function saveTemplate(input: { id?: string; category: "speaker" | "soundbar"; name: string; items: ChecklistItem[]; approved: boolean; aiDrafted?: boolean }): Promise<ActionState> {
  return run((p) => wf.saveTemplate(p, input).then(() => (input.approved ? "Checklist approved - used for new QC requests" : "Draft saved")));
}

// ---------------------------------------------------------------- AI

export async function uploadDocument(_: ActionState, f: FormData) {
  return run(async (p) => {
    const file = f.get("file");
    if (!(file instanceof File) || file.size === 0) throw new wf.WorkflowError("Choose a PDF or image to upload");
    if (file.size > 10 * 1024 * 1024) throw new wf.WorkflowError("File is larger than 10 MB");
    const okTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!okTypes.includes(file.type)) throw new wf.WorkflowError("Upload a PDF, JPG, PNG or WebP");
    const bytes = Buffer.from(await file.arrayBuffer());
    const poId = str(f, "poId");
    const lotId = str(f, "lotId") || null;

    const { documentType, fields } = await extractDocument(bytes, file.type);
    const chosen = str(f, "type") as DocType | "auto";
    const type = chosen && chosen !== "auto" ? chosen : documentType;
    const storagePath = await storeFile(`${poId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`, bytes, file.type);
    const { issues } = await wf.addDocument(p, { poId, lotId, type, fileName: file.name, storagePath, extracted: fields });
    return issues.length ? `Read as ${type.replace(/_/g, " ")} - ${issues.length} mismatch${issues.length > 1 ? "es" : ""} flagged` : `Read as ${type.replace(/_/g, " ")} - matches the PO`;
  });
}

type AiResult = { text?: string; error?: string };

async function ai(fn: (p: Persona) => Promise<string>): Promise<AiResult> {
  const p = await requirePersona();
  try {
    return { text: await fn(p) };
  } catch (e) {
    const msg = aiErrorMessage(e);
    if (msg) return { error: msg };
    console.error(e);
    return { error: "Claude could not complete this - check the server log" };
  }
}

export async function explainRisk(poId: string): Promise<AiResult> {
  return ai(async (p) => {
    const snap = await getSnapshot();
    const v = scopeViews(snap, p).find((x) => x.po.id === poId);
    if (!v) throw new wf.WorkflowError("PO not found");
    const s = snap.stats.get(v.vendor.id);
    return generateText(
      `Explain the delay risk on this purchase order to ${p.title}. Format:
- One sentence: will it be late, and by roughly how many days.
- "Why:" 2-3 bullets, each tied to a risk factor and its number.
- "Do now:" 2-3 concrete actions, each naming who acts (vendor, procurement, QC, logistics, warehouse, finance).
Under 110 words. Markdown.`,
      {
        today: fmtDate(snap.now, true), po: v.po.poNumber, product: v.po.productName, qty: v.po.totalQty, valueUsd: v.po.totalValueUsd, vendor: v.vendor.name, stage: v.stage,
        promisedReady: fmtDate(v.po.promisedReadyDate, true), productionPct: v.po.productionPct, riskScore: v.risk.score, riskLevel: v.risk.level,
        projectedDelayDays: v.risk.projectedDelayDays, factors: v.risk.factors,
        vendorHistory: s && { onTimePct: s.onTimePct, avgDaysLate: s.avgDelayDays, qcFirstPassPct: s.firstPassPct, completedOrders: s.completed },
        lots: v.lots.map((l) => ({ lot: l.lotNumber, status: l.status, eta: fmtDate(l.eta), originalEta: fmtDate(l.originalEta), arrived: fmtDate(l.arrivedAt), port: l.portOfDischarge })),
        lastQc: v.inspections.at(-1)?.summary,
      },
      1000,
    );
  });
}

export async function dailyBrief(): Promise<AiResult> {
  return ai(async (p) => {
    const snap = await getSnapshot();
    const views = scopeViews(snap, p);
    const open = views.filter((v) => v.open);
    const lots = open.flatMap((v) => v.lots.filter((l) => l.status !== "RECEIVED").map((l) => ({ v, l })));
    return generateText(
      `Write today's supply brief for ${p.name}, ${p.title}. Format:
- A one-line headline with the single most important thing.
- "Needs a decision" - at most 3 bullets, the items only this person can unblock, each with PO number, vendor, what is at stake in USD or days.
- "Watch" - at most 3 bullets.
- "Going well" - 1 or 2 bullets.
- Last line: "Recommended:" one action for today.
Under 170 words. Markdown. No greeting.`,
      {
        today: fmtDate(snap.now, true),
        openPos: open.length,
        openValueUsd: Math.round(open.reduce((a, v) => a + v.po.totalValueUsd, 0)),
        inTransitValueUsd: Math.round(lots.reduce((a, { v, l }) => a + (l.qty / v.po.totalQty) * v.po.totalValueUsd, 0)),
        byStage: Object.entries(open.reduce<Record<string, number>>((a, v) => ((a[v.stage] = (a[v.stage] ?? 0) + 1), a), {})),
        atRisk: open.filter((v) => v.risk.level !== "low").map((v) => ({ po: v.po.poNumber, vendor: v.vendor.name, product: v.po.productName, valueUsd: v.po.totalValueUsd, stage: v.stage, risk: v.risk.level, score: v.risk.score, projectedDelayDays: v.risk.projectedDelayDays, why: v.risk.factors.slice(0, 2).map((f) => f.detail) })),
        alerts: scopeAlerts(snap, p).filter((a) => a.kind !== "Delay risk").map((a) => ({ kind: a.kind, po: a.poNumber, vendor: a.vendorName, title: a.title, detail: a.detail })),
        vendors: snap.vendors.map((v) => ({ vendor: v.name, ...snap.stats.get(v.id) })),
      },
      1400,
    );
  });
}

export async function vendorSummary(vendorId: string): Promise<AiResult> {
  return ai(async (p) => {
    if (p.role === "vendor" && p.vendorId !== vendorId) throw new wf.WorkflowError("Not your scorecard");
    const snap = await getSnapshot();
    const vendor = snap.vendors.find((v) => v.id === vendorId);
    if (!vendor) throw new wf.WorkflowError("Vendor not found");
    const templates = await getTemplates();
    const mine = snap.views.filter((v) => v.vendor.id === vendorId);
    const defects: Record<string, number> = {};
    for (const v of mine) for (const q of v.inspections) for (const r of q.results) {
      if (r.result !== "fail") continue;
      const check = templates.find((t) => t.id === q.templateId)?.items.find((i) => i.id === r.itemId)?.check ?? r.itemId;
      defects[check] = (defects[check] ?? 0) + 1;
    }
    return generateText(
      `Write a vendor review for the procurement team. Format:
- One-line verdict: keep growing, hold steady, or put on a recovery plan.
- "Strengths" 1-2 bullets, "Concerns" 2-3 bullets - each with its number.
- "Defect pattern" 1-2 bullets on what keeps failing QC and the likely root cause.
- "Recommended:" one line - what to change in how we order from or manage this vendor.
Under 150 words. Markdown.`,
      {
        vendor: vendor.name, city: vendor.city, terms: `${vendor.advancePct}% advance, ${vendor.creditDays} days credit`, stats: snap.stats.get(vendorId),
        peers: snap.vendors.filter((v) => v.id !== vendorId).map((v) => ({ vendor: v.name, onTimePct: snap.stats.get(v.id)?.onTimePct, qcFirstPassPct: snap.stats.get(v.id)?.firstPassPct })),
        qcFailsByCheck: defects,
        openOrders: mine.filter((v) => v.open).map((v) => ({ po: v.po.poNumber, stage: v.stage, risk: v.risk.level, valueUsd: v.po.totalValueUsd })),
      },
      1200,
    );
  });
}

export async function aiDraftChecklist(category: "speaker" | "soundbar", product: string, notes: string): Promise<{ name?: string; items?: ChecklistItem[]; error?: string }> {
  const p = await requirePersona();
  if (p.role !== "procurement" && p.role !== "csco") return { error: "Only procurement can draft checklists" };
  if (!product.trim()) return { error: "Name the product first" };
  try {
    const snap = await getSnapshot();
    const history = new Set<string>();
    for (const v of snap.views) if (v.po.category === category) for (const q of v.inspections) for (const r of q.results) if (r.result === "fail" && r.note) history.add(r.note);
    return await draftChecklist(category, product.trim(), notes.trim(), [...history].slice(0, 12));
  } catch (e) {
    const msg = aiErrorMessage(e);
    if (!msg) console.error(e);
    return { error: msg ?? "Claude could not draft the checklist - check the server log" };
  }
}

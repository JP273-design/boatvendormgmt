import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Category, ChecklistItem } from "@/db/schema";

export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

export class AiNotConfigured extends Error {
  constructor() {
    super("AI is not configured - add ANTHROPIC_API_KEY to .env.local and restart");
  }
}

export const aiReady = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
export function anthropic() {
  if (!aiReady()) throw new AiNotConfigured();
  return (client ??= new Anthropic());
}

/** Turn SDK / config failures into a sentence a user can act on. */
export function aiErrorMessage(e: unknown) {
  if (e instanceof AiNotConfigured) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "Claude rejected the API key - check ANTHROPIC_API_KEY";
  if (e instanceof Anthropic.RateLimitError) return "Claude is rate-limiting us - try again in a minute";
  if (e instanceof Anthropic.NotFoundError) return `Model "${MODEL}" was not found - check CLAUDE_MODEL`;
  if (e instanceof Anthropic.APIError) return `Claude API error (${e.status ?? "network"}) - ${e.message}`;
  return null;
}

const VOICE =
  "You write for busy supply-chain and finance people at a consumer electronics brand that imports finished goods from China. Be direct and specific. Short bullets, no preamble, no hedging. Use the numbers you are given - never invent data. Money is in USD. Dates as '12 Mar'.";

export async function generateText(task: string, data: unknown, maxTokens = 1200) {
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: VOICE,
    messages: [{ role: "user", content: `${task}\n\n<data>\n${JSON.stringify(data)}\n</data>` }],
  });
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
}

// ---------------------------------------------------------------- document reading

export type DocType = "packing_list" | "bill_of_lading" | "invoice" | "other";

const DOC_TOOL: Anthropic.Tool = {
  name: "record_document",
  description: "Record the fields read from a shipping or commercial document. Only fill a field if it is actually printed on the document; leave it out otherwise.",
  input_schema: {
    type: "object",
    properties: {
      documentType: { type: "string", enum: ["packing_list", "bill_of_lading", "invoice", "other"] },
      poNumber: { type: "string", description: "Buyer purchase order number" },
      lotNumber: { type: "string" },
      invoiceNumber: { type: "string" },
      blNumber: { type: "string", description: "Bill of lading number" },
      containerNo: { type: "string", description: "Container number, 4 letters + 7 digits" },
      vessel: { type: "string" },
      portOfLoading: { type: "string" },
      portOfDischarge: { type: "string" },
      totalUnits: { type: "number", description: "Packing list: total pieces / units" },
      totalCartons: { type: "number", description: "Packing list: total cartons" },
      cartons: { type: "number", description: "Bill of lading: number of packages / cartons" },
      quantity: { type: "number", description: "Invoice: total quantity billed" },
      unitPriceUsd: { type: "number" },
      totalUsd: { type: "number", description: "Invoice grand total" },
      currency: { type: "string" },
      grossWeightKg: { type: "number" },
      notes: { type: "string", description: "Anything unusual a reviewer should know, in one sentence" },
    },
    required: ["documentType"],
  },
};

export async function extractDocument(bytes: Buffer, mediaType: string) {
  const data = bytes.toString("base64");
  const file: Anthropic.ContentBlockParam =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data } };
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 2000,
    // Newer models do not accept a forced tool_choice, so we ask for the call in the prompt instead.
    system: "You read shipping and commercial documents. Always answer by calling the record_document tool exactly once. Never answer in plain text.",
    tools: [DOC_TOOL],
    messages: [
      {
        role: "user",
        content: [file, { type: "text", text: "Read this document and record its fields. Copy numbers exactly as printed - do not correct or round them." }],
      },
    ],
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("Claude could not read this document");
  const { documentType, ...fields } = block.input as { documentType: DocType } & Record<string, unknown>;
  return { documentType, fields };
}

// ---------------------------------------------------------------- QC checklist drafting

const CHECKLIST_TOOL: Anthropic.Tool = {
  name: "save_checklist",
  description: "Save a pre-shipment inspection checklist.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Checklist title, e.g. 'Stone 1200F - pre-shipment inspection'" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            section: { type: "string", description: "Group heading, e.g. 'Packaging & labelling', 'Function', 'Audio', 'Safety & reliability'" },
            check: { type: "string", description: "What must be true, one line, with the pass threshold" },
            method: { type: "string", description: "How the inspector verifies it at the factory, a few words" },
            critical: { type: "boolean", description: "True if a single failure should fail the whole lot" },
          },
          required: ["section", "check", "method", "critical"],
        },
      },
    },
    required: ["name", "items"],
  },
};

export async function draftChecklist(category: Category, product: string, notes: string, defectHistory: string[]) {
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 4000,
    system:
      "You are a senior quality engineer for consumer audio products made in China and sold in India. You write practical pre-shipment inspection checklists an inspector can complete at the factory in half a day. Always answer by calling the save_checklist tool exactly once. Never answer in plain text.",
    tools: [CHECKLIST_TOOL],
    messages: [
      {
        role: "user",
        content: `Draft a pre-shipment QC checklist for: ${product} (category: ${category}).

- 12 to 16 checks, grouped into 4-6 sections.
- Cover packaging and India compliance (BIS/CRS mark, MRP label), appearance, function, audio performance, battery or mains safety as relevant, and transit reliability.
- Each check states its pass threshold. Mark as critical only what should fail the lot outright.
${notes ? `- Buyer's notes: ${notes}` : ""}
${defectHistory.length ? `- Defects found on past inspections of this category - make sure the checklist would catch them:\n${defectHistory.map((d) => `  - ${d}`).join("\n")}` : ""}`,
      },
    ],
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("Claude did not return a checklist");
  const out = block.input as { name: string; items: Omit<ChecklistItem, "id">[] };
  return { name: out.name, items: out.items.map((it, i) => ({ ...it, id: `a${i + 1}` })) };
}

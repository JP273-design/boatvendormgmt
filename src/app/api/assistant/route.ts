import type Anthropic from "@anthropic-ai/sdk";
import { aiErrorMessage, anthropic, MODEL } from "@/lib/ai";
import { ASSISTANT_TOOLS, runAssistantTool } from "@/lib/assistant-tools";
import { getSnapshot } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/personas";
import { getPersona } from "@/lib/session";

export const maxDuration = 60;

type ChatTurn = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const persona = await getPersona();
  if (!persona) return new Response("Not signed in", { status: 401 });

  const body = (await req.json()) as { messages?: ChatTurn[] };
  const turns = (body.messages ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()).slice(-20);
  if (!turns.length || turns[turns.length - 1].role !== "user") return new Response("No question", { status: 400 });

  const snap = await getSnapshot();
  const system = `You are the assistant inside a vendor management system for a consumer electronics brand that imports finished goods (speakers, soundbars) from vendors in China. The workflow: PO issued in SAP -> vendor accepts and promises a lead time -> production -> vendor requests QC -> inspection -> lot created -> shipped by container -> India port -> customs -> warehouse GRN in SAP closes the PO -> payment released per terms.

You are talking to ${persona.name}, ${persona.title} (${ROLE_LABEL[persona.role]}).${persona.role === "vendor" ? " They are an external vendor: they can only see their own orders, and you must not speculate about other vendors." : ""}
Today is ${fmtDate(snap.now, true)}.

How to answer:
- Always use the tools to look things up. Never answer from memory or guess numbers.
- Lead with the answer. Short bullets. A small table when comparing more than three items.
- Refer to orders by PO number. Money in USD. Dates like "12 Mar".
- If something needs action, end with one line: "Recommended: ..." naming who should do what.
- If the data does not contain the answer, say so in one line.`;

  const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        const client = anthropic();
        // Manual agentic loop so text streams to the browser while tools run server-side.
        for (let step = 0; step < 8; step++) {
          const run = client.messages.stream({ model: MODEL, max_tokens: 4000, system, tools: ASSISTANT_TOOLS, messages });
          run.on("text", (delta) => send(delta));
          const message = await run.finalMessage();
          if (message.stop_reason !== "tool_use") break;

          messages.push({ role: "assistant", content: message.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const block of message.content) {
            if (block.type !== "tool_use") continue;
            const out = await runAssistantTool(block.name, block.input as Record<string, unknown>, snap, persona);
            results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
          }
          messages.push({ role: "user", content: results });
          send("\n\n");
        }
      } catch (e) {
        const msg = aiErrorMessage(e);
        if (!msg) console.error("assistant failed", e);
        send(`\n\n_${msg ?? "Something went wrong talking to Claude - check the server log."}_`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

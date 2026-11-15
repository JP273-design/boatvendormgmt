"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Sparkles, X } from "lucide-react";
import { Markdown } from "./markdown";

type Turn = { role: "user" | "assistant"; content: string };

/** Ask-your-data chat. Streams from /api/assistant, which answers with read-only tools scoped to this persona. */
export function Assistant({ suggestions, name }: { suggestions: string[]; name: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history: Turn[] = [...turns, { role: "user", content: q }];
    setTurns([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    let answer = "";
    const show = (text: string) => setTurns([...history, { role: "assistant", content: text }]);
    try {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history }) });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        show(answer);
      }
      if (!answer.trim()) show("_No answer came back - try again._");
    } catch {
      show(`${answer}\n\n_The assistant could not be reached - try again._`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full bg-navy px-4 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-slate-800">
        <Sparkles className="h-4 w-4" /> Ask
      </button>
    );
  }

  return (
    <aside className="fixed inset-0 z-50 flex flex-col bg-white shadow-2xl sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[640px] sm:max-h-[calc(100vh-2rem)] sm:w-[420px] sm:rounded-2xl sm:border sm:border-line">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Sparkles className="h-4 w-4 text-brand" />
        <div className="flex-1 text-sm font-semibold">Ask your supply chain</div>
        {turns.length > 0 && (
          <button onClick={() => setTurns([])} className="text-xs text-muted hover:text-ink" disabled={busy}>
            Clear
          </button>
        )}
        <button onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded p-1 text-muted hover:bg-slate-100 hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <div>
            <p className="text-sm text-muted">Hi {name.split(" ")[0]} - ask anything about orders, vendors, containers or payments. Answers come from live data.</p>
            <div className="mt-4 flex flex-col gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-lg border border-line px-3 py-2 text-left text-sm transition hover:border-slate-400 hover:bg-slate-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="ml-8 rounded-2xl rounded-br-md bg-navy px-3.5 py-2 text-sm text-white">{t.content}</div>
          ) : (
            <div key={i} className="mr-2">
              {t.content ? <Markdown>{t.content}</Markdown> : <p className="animate-pulse text-sm text-muted">Looking that up…</p>}
            </div>
          ),
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex items-center gap-2 border-t border-line p-3"
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Which POs are at risk this week ?" className="input" autoFocus />
        <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="btn btn-primary h-9 w-9 shrink-0 rounded-full p-0">
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>
    </aside>
  );
}

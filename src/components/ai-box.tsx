"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Markdown } from "./markdown";

/** A button that asks Claude for a short write-up (risk explanation, daily brief, vendor review) and shows it in place. */
export function AiBox({ label, run, auto }: { label: string; run: () => Promise<{ text?: string; error?: string }>; auto?: boolean }) {
  const [result, setResult] = useState<{ text?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const go = () => start(async () => setResult(await run()));

  return (
    <div>
      {result?.text && <Markdown>{result.text}</Markdown>}
      {result?.error && <p className="text-xs font-medium text-red-600">{result.error}</p>}
      {pending && <p className="animate-pulse text-sm text-muted">Claude is reading the data…</p>}
      {!pending && (
        <button type="button" onClick={go} className={`btn btn-sm ${result ? "mt-2" : ""} ${auto ? "btn-dark" : ""}`}>
          <Sparkles className="h-3.5 w-3.5" />
          {result ? "Regenerate" : label}
        </button>
      )}
    </div>
  );
}

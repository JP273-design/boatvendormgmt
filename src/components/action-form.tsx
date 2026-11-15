"use client";

import { startTransition, useActionState, type ReactNode } from "react";
import clsx from "clsx";

export type ActionState = { error?: string; ok?: string } | null;
type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * A form bound to a server action. Shows the workflow engine's error message
 * inline (e.g. "Container number fails its check digit") and a pending state.
 */
export function ActionForm({
  action,
  children,
  submit,
  className,
  variant = "primary",
  small,
  hidden,
  confirm,
}: {
  action: Action;
  children?: ReactNode;
  submit: ReactNode;
  className?: string;
  variant?: "primary" | "dark" | "plain";
  small?: boolean;
  hidden?: Record<string, string>;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      className={className}
      onSubmit={(e) => {
        // Submit by hand so React does not wipe what the user typed when the server rejects it.
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <div className={clsx("flex flex-wrap items-center gap-2", children ? "mt-3" : "")}>
        <button type="submit" disabled={pending} className={clsx("btn", variant === "primary" && "btn-primary", variant === "dark" && "btn-dark", small && "btn-sm")}>
          {pending ? "Working…" : submit}
        </button>
        {state?.error && <span role="alert" className="text-xs font-medium text-red-600">{state.error}</span>}
        {state?.ok && !pending && <span className="text-xs font-medium text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}

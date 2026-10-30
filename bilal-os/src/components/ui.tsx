"use client";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Result = { ok: boolean; message?: string; data?: any };

/** A button that runs a server action and shows the outcome. */
export function ActionButton(props: {
  action: () => Promise<Result | void>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  onDone?: (r: Result | void) => void;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Result | null>(null);
  const router = useRouter();
  return (
    <span className="row" style={{ display: "inline-flex" }}>
      <button
        className={`btn ${props.className ?? ""}`}
        disabled={pending}
        onClick={() => {
          if (props.confirm && !window.confirm(props.confirm)) return;
          start(async () => {
            try {
              const r = await props.action();
              if (r && r.message) setMsg(r);
              props.onDone?.(r);
              router.refresh();
            } catch (e) {
              setMsg({ ok: false, message: (e as Error).message });
            }
          });
        }}
      >
        {pending ? "…" : props.children}
      </button>
      {msg?.message && <small className={msg.ok ? "tone-good" : "tone-bad"}>{msg.message}</small>}
    </span>
  );
}

export function Toggle({ checked, action, label }: { checked: boolean; action: (v: boolean) => Promise<Result>; label?: string }) {
  const [on, setOn] = useState(checked);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <label className="switch" title={label} aria-label={label} style={{ margin: 0 }}>
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.checked;
          setOn(v);
          start(async () => { await action(v); router.refresh(); });
        }}
      />
      <span />
    </label>
  );
}

/** Form wired to a (prevState, formData) server action. */
export function ActionForm(props: {
  action: (prev: Result | null, form: FormData) => Promise<Result>;
  children: React.ReactNode;
  submit: string;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(props.action, null);
  return (
    <form action={formAction} className={props.className} key={props.resetOnSuccess && state?.ok ? Math.random() : undefined}>
      {props.children}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={pending}>{pending ? "…" : props.submit}</button>
        {state?.message && <small className={state.ok ? "tone-good" : "tone-bad"}>{state.message}</small>}
      </div>
    </form>
  );
}

/** Inline editor for one setting value. */
export function InlineField(props: {
  label: string;
  value: string | number | boolean;
  type?: "string" | "number" | "boolean" | "text" | "password" | "time";
  help?: string;
  placeholder?: string;
  save: (v: any) => Promise<Result>;
}) {
  const [v, setV] = useState<any>(props.type === "password" ? "" : props.value);
  const [msg, setMsg] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const doSave = () =>
    start(async () => {
      const r = await props.save(v);
      setMsg(r);
      if (r.ok && props.type === "password") setV("");
      router.refresh();
    });
  return (
    <div>
      <label>{props.label}</label>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        {props.type === "boolean" ? (
          <input type="checkbox" checked={Boolean(v)} onChange={(e) => setV(e.target.checked)} />
        ) : props.type === "text" ? (
          <textarea value={v} placeholder={props.placeholder} onChange={(e) => setV(e.target.value)} />
        ) : (
          <input
            type={props.type === "number" ? "number" : props.type === "password" ? "password" : props.type === "time" ? "time" : "text"}
            value={v}
            placeholder={props.placeholder}
            autoComplete="off"
            step="any"
            onChange={(e) => setV(e.target.value)}
          />
        )}
        <button className="btn" disabled={pending} onClick={doSave} type="button">{pending ? "…" : "Save"}</button>
      </div>
      {props.help && <div className="help">{props.help}</div>}
      {msg?.message && <small className={msg.ok ? "tone-good" : "tone-bad"}>{msg.message}</small>}
    </div>
  );
}

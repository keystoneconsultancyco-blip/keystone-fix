// Server-rendered building blocks shared by the hub and sector pages.
import Link from "next/link";
import { fmtDateTime, fmtTime, relative, fmtDate } from "@/lib/time";
import type { Kpi } from "@/lib/agent/types";
import type { Approval } from "@/lib/approvals";
import { ActionButton, Toggle } from "./ui";
import { decideApprovalAction, readAlertAction, runAgentAction, toggleAgentAction } from "@/app/actions";

export function KpiCards({ kpis }: { kpis: Kpi[] }) {
  if (!kpis.length) return <div className="card empty">No KPIs yet — they appear when this sector has agents.</div>;
  return (
    <div className="grid cols-4">
      {kpis.map((k) => (
        <div className="card kpi" key={k.label}>
          <div className="label">{k.label}</div>
          <div className={`value tone-${k.tone ?? "neutral"}`}>{k.value}</div>
          {k.hint && <div className="help">{k.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function AlertsList({ alerts }: { alerts: { id: number; ts: Date; severity: string; title: string; body: string | null; url: string | null; sector_id: string }[] }) {
  if (!alerts.length) return <div className="empty">Nothing needs your attention. 🎉</div>;
  return (
    <ul className="list">
      {alerts.map((a) => (
        <li key={a.id}>
          <span className={`badge ${a.severity}`}>{a.severity}</span>
          <div className="grow">
            <div><b>{a.title}</b></div>
            {a.body && <div className="muted" style={{ fontSize: "0.88rem", whiteSpace: "pre-wrap" }}>{a.body}</div>}
            <small className="muted">{relative(a.ts)} · {a.sector_id}{a.url && <> · <a href={a.url} target="_blank" rel="noreferrer">open</a></>}</small>
          </div>
          <ActionButton className="small" action={readAlertAction.bind(null, a.id)}>Done</ActionButton>
        </li>
      ))}
    </ul>
  );
}

export function ApprovalsList({ approvals }: { approvals: Approval[] }) {
  if (!approvals.length) return <div className="empty">Nothing waiting for approval.</div>;
  return (
    <ul className="list">
      {approvals.map((a) => (
        <li key={a.id} style={{ flexDirection: "column" }}>
          <div className="row" style={{ justifyContent: "space-between", width: "100%" }}>
            <b>{a.title}</b>
            <small className="muted">{a.sector_id} · {relative(a.created_at)}</small>
          </div>
          {a.summary && <pre className="pre" style={{ width: "100%", maxHeight: 320, overflow: "auto" }}>{a.summary}</pre>}
          <div className="row">
            <ActionButton className="primary small" action={decideApprovalAction.bind(null, a.id, "approve", undefined)}>✅ Approve</ActionButton>
            <ActionButton className="small danger" action={decideApprovalAction.bind(null, a.id, "reject", undefined)}>❌ Reject</ActionButton>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AgentsTable({ agents }: { agents: { id: string; name: string; description: string | null; enabled: boolean; schedule: string | null; last_run_at: Date | null; last_status: string | null; next_run_at: Date | null; essential: boolean }[] }) {
  if (!agents.length) return <div className="card empty">No agents in this sector yet. See <code>docs/ADDING_AN_AGENT.md</code> — ask Claude Code to add one.</div>;
  return (
    <div className="card scroll-x">
      <table className="table">
        <thead><tr><th>On</th><th>Agent</th><th>Status</th><th>Last run</th><th>Next run</th><th></th></tr></thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.id}>
              <td><Toggle checked={a.enabled} action={toggleAgentAction.bind(null, a.id)} label={`Turn ${a.name} on or off`} /></td>
              <td>
                <b>{a.name}</b> {a.essential && <span className="badge info">essential</span>}
                <div className="muted" style={{ fontSize: "0.82rem" }}>{a.description}</div>
              </td>
              <td>{a.last_status ? <span className={`badge ${a.last_status}`}>{a.last_status}</span> : <span className="muted">never run</span>}</td>
              <td className="muted">{a.last_run_at ? relative(a.last_run_at) : "—"}</td>
              <td className="muted">{a.enabled && a.next_run_at ? fmtDateTime(a.next_run_at) : a.schedule ? "paused" : "on demand"}</td>
              <td><ActionButton className="small" action={runAgentAction.bind(null, a.id)}>Run now</ActionButton></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ActivityList({ items, showAgent = true }: { items: { id: number; ts: Date; level: string; message: string; agent_id: string | null; sector_id: string | null }[]; showAgent?: boolean }) {
  if (!items.length) return <div className="empty">No activity yet.</div>;
  return (
    <ul className="list">
      {items.map((i) => (
        <li key={i.id}>
          <span className="time">{fmtDate(i.ts)} {fmtTime(i.ts)}</span>
          <span className={`badge ${i.level}`}>{i.level}</span>
          <div className="grow">
            {i.message}
            {showAgent && (i.agent_id || i.sector_id) && <small className="muted"> · {i.agent_id ?? i.sector_id}</small>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SpendBar({ spent, cap }: { spent: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>£{spent.toFixed(2)}</b><small className="muted">of £{cap.toFixed(2)} this month</small>
      </div>
      <div className={`progress ${pct >= 100 ? "bad" : pct >= 80 ? "warn" : ""}`} style={{ marginTop: 6 }}><div style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function SectorLink({ id, children }: { id: string; children: React.ReactNode }) {
  return <Link href={`/sectors/${id}`}>{children}</Link>;
}

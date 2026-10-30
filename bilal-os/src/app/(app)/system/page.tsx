import Link from "next/link";
import { workerHealth, spendByModel } from "@/lib/queries";
import { costStatus } from "@/lib/cost";
import { q } from "@/lib/db";
import { SpendBar } from "@/components/blocks";
import { relative, fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const [health, cost, byModel, byAgent, runs] = await Promise.all([
    workerHealth(), costStatus(), spendByModel(),
    q<{ agent_id: string | null; cost: number; calls: number }>(
      `SELECT agent_id, sum(cost_gbp)::float AS cost, count(*)::int AS calls FROM llm_usage
       WHERE ts >= date_trunc('month', now() AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London' GROUP BY agent_id ORDER BY cost DESC`,
    ),
    q<{ id: number; agent_id: string; trigger: string; started_at: Date; finished_at: Date | null; status: string; summary: string | null; error: string | null }>(
      "SELECT id, agent_id, trigger, started_at, finished_at, status, summary, error FROM agent_runs ORDER BY id DESC LIMIT 50",
    ),
  ]);
  return (
    <>
      <div className="pagehead"><h1>Health &amp; spend</h1></div>
      <nav className="card row mobile-only" style={{ marginBottom: 14 }}>
        <Link className="btn" href="/settings">⚙️ Settings</Link>
        <Link className="btn" href="/setup">🔑 Setup</Link>
        <Link className="btn" href="/activity">📜 Activity</Link>
        <Link className="btn" href="/sectors">🧩 Sectors</Link>
      </nav>
      <div className="grid cols-2">
        <section className="card stack">
          <h2>🩺 Worker</h2>
          <div className="row"><span className={`dot ${health.ok ? "good" : "bad"}`} /> Heartbeat {health.heartbeat ? relative(health.heartbeat) : "never"}</div>
          {health.info && <small className="muted">Uptime {Math.round(health.info.uptimeSec / 3600)}h · memory {health.info.rssMb} MB · {health.info.agents} agents</small>}
          {health.failing.length ? (
            <ul className="list">{health.failing.map((f) => <li key={f.key}><span className="badge bad">{f.consecutive_failures}×</span><div className="grow"><b>{f.key}</b><div className="muted" style={{ fontSize: "0.82rem" }}>{f.last_error}</div></div></li>)}</ul>
          ) : <div className="empty">No failing jobs.</div>}
          <p className="help">Health check URL for monitoring: <code>/api/health</code></p>
        </section>
        <section className="card stack">
          <h2>💷 AI spend this month</h2>
          <SpendBar spent={cost.spent} cap={cost.cap} />
          <table className="table"><thead><tr><th>Model</th><th>Calls</th><th>£</th></tr></thead>
            <tbody>{byModel.map((m) => <tr key={m.model}><td>{m.model}</td><td>{m.calls}</td><td>{m.cost.toFixed(3)}</td></tr>)}</tbody></table>
          <table className="table"><thead><tr><th>Agent</th><th>Calls</th><th>£</th></tr></thead>
            <tbody>{byAgent.map((m) => <tr key={m.agent_id ?? "-"}><td>{m.agent_id ?? "(dashboard)"}</td><td>{m.calls}</td><td>{m.cost.toFixed(3)}</td></tr>)}</tbody></table>
        </section>
      </div>
      <section className="card scroll-x" style={{ marginTop: 14 }}>
        <h2>Recent runs</h2>
        <table className="table">
          <thead><tr><th>When</th><th>Agent</th><th>Trigger</th><th>Status</th><th>Summary</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="muted">{fmtDateTime(r.started_at)}</td>
                <td>{r.agent_id}</td>
                <td className="muted">{r.trigger}</td>
                <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                <td style={{ maxWidth: 420 }}>{r.summary ?? (r.error ? <span className="tone-bad">{r.error.split("\n")[0]}</span> : "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

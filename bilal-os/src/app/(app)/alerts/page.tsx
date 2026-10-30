import { openAlerts } from "@/lib/queries";
import { q } from "@/lib/db";
import { AlertsList } from "@/components/blocks";
import { ActionButton } from "@/components/ui";
import { readAllAlertsAction } from "../../actions";
import { relative } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const [open, old] = await Promise.all([
    openAlerts(undefined, 200),
    q<{ id: number; ts: Date; severity: string; title: string; sector_id: string }>("SELECT id, ts, severity, title, sector_id FROM alerts WHERE read_at IS NOT NULL ORDER BY ts DESC LIMIT 50"),
  ]);
  return (
    <>
      <div className="pagehead">
        <h1>Alerts</h1>
        {open.length > 0 && <ActionButton action={readAllAlertsAction.bind(null, undefined)}>Mark all done</ActionButton>}
      </div>
      <p className="help">🚨 crucial = Telegram immediately · ⚠️ important = Telegram unless it&apos;s quiet hours (then in your morning briefing) · info = dashboard + daily briefing only.</p>
      <section className="card"><AlertsList alerts={open} /></section>
      <section className="card" style={{ marginTop: 14 }}>
        <h2>History</h2>
        <ul className="list">{old.map((a) => <li key={a.id}><span className={`badge ${a.severity}`}>{a.severity}</span><div className="grow">{a.title}</div><small className="muted">{a.sector_id} · {relative(a.ts)}</small></li>)}</ul>
      </section>
    </>
  );
}

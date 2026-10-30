import Link from "next/link";
import { todaysEvents, openTasks, upcomingDeadlines, openAlerts, workerHealth } from "@/lib/queries";
import { pendingApprovals } from "@/lib/approvals";
import { costStatus } from "@/lib/cost";
import { fmtTime, fmtDateTime, relative, londonParts } from "@/lib/time";
import { AlertsList, ApprovalsList, SpendBar } from "@/components/blocks";
import { ActionButton, ActionForm } from "@/components/ui";
import { addTaskAction, completeTaskAction, completeDeadlineAction } from "../actions";

export const dynamic = "force-dynamic";

function greeting() {
  const h = londonParts().hour;
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function Hub() {
  const [events, tomorrow, tasks, deadlines, alerts, approvals, cost, health] = await Promise.all([
    todaysEvents(0), todaysEvents(1), openTasks(), upcomingDeadlines(21), openAlerts(undefined, 20), pendingApprovals(), costStatus(), workerHealth(),
  ]);
  const today = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" }).format(new Date());
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{greeting()}, Bilal</h1>
          <div className="muted">{today}</div>
        </div>
        <div className="row">
          <span className={`dot ${health.ok ? "good" : "bad"}`} />
          <small className="muted">{health.ok ? "All systems running" : health.heartbeat ? `Worker silent since ${relative(health.heartbeat)}` : "Worker not started yet"}</small>
        </div>
      </div>

      <div className="grid cols-2">
        <section className="card">
          <div className="card-head"><h2>📅 Today</h2><small className="muted">{events.length} item{events.length === 1 ? "" : "s"}</small></div>
          {events.length ? (
            <ul className="list">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="time">{e.all_day ? "All day" : `${fmtTime(e.start_at)}–${fmtTime(e.end_at)}`}</span>
                  <div className="grow"><b>{e.title}</b>{e.location && <div className="muted" style={{ fontSize: "0.85rem" }}>📍 {e.location}</div>}</div>
                  {e.source === "timetable" && <span className="badge info">uni</span>}
                </li>
              ))}
            </ul>
          ) : <div className="empty">Nothing in the calendar today.</div>}
          {tomorrow.length > 0 && <p className="help" style={{ marginTop: 8 }}>Tomorrow: {tomorrow.slice(0, 3).map((e) => `${e.all_day ? "" : fmtTime(e.start_at) + " "}${e.title}`).join(" · ")}{tomorrow.length > 3 ? " …" : ""}</p>}
        </section>

        <section className="card">
          <div className="card-head"><h2>✅ Tasks &amp; reminders</h2></div>
          {tasks.length ? (
            <ul className="list">
              {tasks.map((t) => (
                <li key={t.id}>
                  <ActionButton className="small" action={completeTaskAction.bind(null, t.id)}>✓</ActionButton>
                  <div className="grow">{t.title}{t.due_at && <div className="muted" style={{ fontSize: "0.82rem" }}>{fmtDateTime(t.due_at)} ({relative(t.due_at)})</div>}</div>
                </li>
              ))}
            </ul>
          ) : <div className="empty">No open tasks. Text the bot "remind me to…" to add one.</div>}
          <ActionForm action={addTaskAction} submit="Add" resetOnSuccess>
            <div className="row" style={{ flexWrap: "nowrap", marginTop: 8 }}>
              <input name="title" placeholder="New task…" required />
              <input name="when" placeholder="when? e.g. fri 4pm" style={{ maxWidth: 170 }} />
            </div>
          </ActionForm>
        </section>

        <section className="card">
          <div className="card-head"><h2>⏰ Deadlines</h2><small className="muted">next 3 weeks</small></div>
          {deadlines.length ? (
            <ul className="list">
              {deadlines.map((d) => {
                const hours = (new Date(d.due_at).getTime() - Date.now()) / 3600_000;
                return (
                  <li key={d.id}>
                    <span className={`badge ${hours < 48 ? "bad" : hours < 168 ? "warn" : ""}`}>{relative(d.due_at)}</span>
                    <div className="grow">
                      {d.url ? <a href={d.url} target="_blank" rel="noreferrer"><b>{d.title}</b></a> : <b>{d.title}</b>}
                      <div className="muted" style={{ fontSize: "0.82rem" }}>{fmtDateTime(d.due_at)} · {d.sector_id}</div>
                    </div>
                    <ActionButton className="small" action={completeDeadlineAction.bind(null, d.id)}>Done</ActionButton>
                  </li>
                );
              })}
            </ul>
          ) : <div className="empty">No deadlines coming up.</div>}
        </section>

        <section className="card">
          <div className="card-head"><h2>🔔 Alerts</h2><Link href="/alerts">All</Link></div>
          <AlertsList alerts={alerts} />
        </section>

        <section className="card">
          <div className="card-head"><h2>🟡 Waiting for you</h2><Link href="/approvals">All</Link></div>
          <ApprovalsList approvals={approvals.slice(0, 5)} />
        </section>

        <section className="card stack">
          <div className="card-head"><h2>💷 AI spend</h2><Link href="/system">Details</Link></div>
          <SpendBar spent={cost.spent} cap={cost.cap} />
          {cost.paused && <div className="notice bad">Budget reached — non-essential AI is paused until the 1st.</div>}
          <div className="card-head" style={{ marginTop: 16 }}><h2>🩺 System</h2></div>
          <div className="row"><span className={`dot ${health.ok ? "good" : "bad"}`} /> Worker heartbeat {health.heartbeat ? relative(health.heartbeat) : "never"}</div>
          {health.failing.length > 0 && <div className="notice bad">{health.failing.length} job{health.failing.length > 1 ? "s" : ""} failing: {health.failing.map((f) => f.key).join(", ")}</div>}
        </section>
      </div>
    </>
  );
}

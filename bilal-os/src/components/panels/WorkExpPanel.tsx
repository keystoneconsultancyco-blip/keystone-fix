import Link from "next/link";
import fs from "node:fs";
import { q } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { dataPath } from "@/lib/browser";
import { fmtDate, relative } from "@/lib/time";
import { ActionButton, ActionForm } from "../ui";
import { addOpportunityUrlAction, saveProfileAction, saveSourcesAction, setOpportunityStatusAction, uploadCvAction } from "@/app/actions";

const STAGES: [string, string][] = [["new", "New"], ["shortlisted", "Shortlisted"], ["drafting", "Drafting"], ["draft_ready", "Draft ready"], ["applied", "Applied"], ["interview", "Interview"], ["offer", "Offer"], ["rejected", "Rejected"], ["ignored", "Ignored"]];

export async function WorkExpPanel({ status }: { status?: string }) {
  const filter = status ?? "active";
  const [counts, rows, profile, sources] = await Promise.all([
    q<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM opportunities GROUP BY status"),
    q<{ id: number; title: string; company: string | null; url: string | null; kind: string | null; location: string | null; deadline: Date | null; score: number | null; score_reason: string | null; status: string; created_at: Date }>(
      `SELECT id, title, company, url, kind, location, deadline, score, score_reason, status, created_at FROM opportunities
       WHERE ${filter === "active" ? "status IN ('new','shortlisted','drafting','draft_ready','applied','interview','offer') AND (deadline IS NULL OR deadline > now() - interval '1 day' OR status IN ('applied','interview','offer'))" : "status = $1"}
       ORDER BY (status = 'new') ASC, score DESC NULLS LAST, deadline NULLS LAST LIMIT 100`,
      filter === "active" ? [] : [filter],
    ),
    getSetting("workexp.profile"),
    getSetting("workexp.sources"),
  ]);
  const count = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  const hasCv = fs.existsSync(dataPath("profile", "cv.pdf"));
  return (
    <div className="stack">
      <section className="card">
        <div className="card-head"><h2>📋 Pipeline</h2></div>
        <div className="row" style={{ marginBottom: 10 }}>
          <Link className={`badge ${filter === "active" ? "info" : ""}`} href="/sectors/workexp">Active</Link>
          {STAGES.map(([k, label]) => <Link key={k} className={`badge ${filter === k ? "info" : ""}`} href={`/sectors/workexp?status=${k}`}>{label} {count[k] ?? 0}</Link>)}
        </div>
        {rows.length ? (
          <ul className="list">
            {rows.map((o) => (
              <li key={o.id} style={{ flexDirection: "column", gap: 6 }}>
                <div className="row" style={{ justifyContent: "space-between", width: "100%" }}>
                  <div>
                    {o.url ? <a href={o.url} target="_blank" rel="noreferrer"><b>{o.title}</b></a> : <b>{o.title}</b>}
                    {o.company && <span className="muted"> — {o.company}</span>}
                  </div>
                  <div className="row">
                    {o.score !== null && <span className={`badge ${o.score >= 75 ? "good" : o.score >= 50 ? "warn" : ""}`}>{o.score}/100</span>}
                    <span className="badge">{o.status.replace("_", " ")}</span>
                  </div>
                </div>
                <small className="muted">
                  {[o.kind?.replace("_", " "), o.location, o.deadline ? `closes ${fmtDate(o.deadline)} (${relative(o.deadline)})` : "no deadline listed", `found ${relative(o.created_at)}`].filter(Boolean).join(" · ")}
                </small>
                {o.score_reason && <small>{o.score_reason}</small>}
                <div className="row">
                  {["new", "shortlisted"].includes(o.status) && <ActionButton className="small primary" action={setOpportunityStatusAction.bind(null, o.id, "drafting")}>✍️ Draft application</ActionButton>}
                  {o.status === "new" && <ActionButton className="small" action={setOpportunityStatusAction.bind(null, o.id, "shortlisted")}>⭐ Shortlist</ActionButton>}
                  {["new", "shortlisted", "draft_ready"].includes(o.status) && <ActionButton className="small" action={setOpportunityStatusAction.bind(null, o.id, "applied")}>Mark applied</ActionButton>}
                  {o.status === "applied" && <ActionButton className="small" action={setOpportunityStatusAction.bind(null, o.id, "interview")}>Got interview</ActionButton>}
                  {o.status === "interview" && <ActionButton className="small" action={setOpportunityStatusAction.bind(null, o.id, "offer")}>Got offer 🎉</ActionButton>}
                  {["applied", "interview"].includes(o.status) && <ActionButton className="small" action={setOpportunityStatusAction.bind(null, o.id, "rejected")}>Rejected</ActionButton>}
                  {["new", "shortlisted"].includes(o.status) && <ActionButton className="small danger" action={setOpportunityStatusAction.bind(null, o.id, "ignored")}>Ignore</ActionButton>}
                </div>
              </li>
            ))}
          </ul>
        ) : <div className="empty">Nothing here yet. The finder runs at 08:10 and 18:10, or add a listing below.</div>}
        <ActionForm action={addOpportunityUrlAction} submit="Add listing" resetOnSuccess>
          <label>Found one yourself? Paste the link</label>
          <input name="url" placeholder="https://…" />
        </ActionForm>
      </section>

      <div className="grid cols-2">
        <section className="card">
          <h2>🧑‍🎓 Your profile (used for drafting)</h2>
          <ActionForm action={uploadCvAction} submit="Upload CV">
            <label>CV (PDF) {hasCv && <span className="badge good">uploaded</span>}</label>
            <input type="file" name="cv" accept="application/pdf" />
          </ActionForm>
          <ActionForm action={saveProfileAction} submit="Save profile">
            <label>About you</label>
            <textarea name="summary" defaultValue={profile.summary} />
            <label>CV text</label>
            <textarea name="cvText" defaultValue={profile.cvText} style={{ minHeight: 180 }} placeholder="Paste your CV here (or upload the PDF above)" />
            <label>Target areas (comma-separated)</label>
            <input name="targets" defaultValue={profile.targets.join(", ")} />
          </ActionForm>
        </section>
        <section className="card">
          <h2>🌐 Where to look</h2>
          <p className="help">Job boards the finder reads. Any page listing opportunities works — the AI reads it like you would. Set &quot;enabled&quot;: false to pause one.</p>
          <ActionForm action={saveSourcesAction} submit="Save sources">
            <textarea name="sources" defaultValue={JSON.stringify(sources, null, 2)} style={{ minHeight: 260, fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }} />
          </ActionForm>
        </section>
      </div>
    </div>
  );
}

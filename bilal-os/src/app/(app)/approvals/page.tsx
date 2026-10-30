import { pendingApprovals } from "@/lib/approvals";
import { q } from "@/lib/db";
import { ApprovalsList } from "@/components/blocks";
import { relative } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const [pending, recent] = await Promise.all([
    pendingApprovals(),
    q<{ id: number; title: string; status: string; decided_at: Date | null; sector_id: string; result: any }>(
      "SELECT id, title, status, decided_at, sector_id, result FROM approvals WHERE status <> 'pending' ORDER BY decided_at DESC NULLS LAST LIMIT 30",
    ),
  ]);
  return (
    <>
      <div className="pagehead"><h1>Approvals</h1></div>
      <section className="card"><ApprovalsList approvals={pending} /></section>
      <section className="card" style={{ marginTop: 14 }}>
        <h2>Recently decided</h2>
        {recent.length ? (
          <ul className="list">
            {recent.map((r) => (
              <li key={r.id}>
                <span className={`badge ${r.status === "done" || r.status === "approved" ? "good" : r.status === "failed" ? "bad" : ""}`}>{r.status}</span>
                <div className="grow">{r.title}{r.result?.error && <div className="tone-bad" style={{ fontSize: "0.85rem" }}>{r.result.error}</div>}</div>
                <small className="muted">{r.sector_id} · {relative(r.decided_at)}</small>
              </li>
            ))}
          </ul>
        ) : <div className="empty">Nothing yet.</div>}
      </section>
    </>
  );
}

import Link from "next/link";
import { sectorsList } from "@/lib/queries";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SectorsIndex() {
  const sectors = await sectorsList();
  const stats = await q<{ sector_id: string; agents: number; alerts: number; approvals: number }>(
    `SELECT s.id AS sector_id,
       (SELECT count(*)::int FROM agents a WHERE a.sector_id = s.id AND a.registered) AS agents,
       (SELECT count(*)::int FROM alerts x WHERE x.sector_id = s.id AND x.read_at IS NULL) AS alerts,
       (SELECT count(*)::int FROM approvals p WHERE p.sector_id = s.id AND p.status = 'pending') AS approvals
     FROM sectors s`,
  );
  const by = Object.fromEntries(stats.map((s) => [s.sector_id, s]));
  return (
    <>
      <div className="pagehead"><h1>Sectors</h1><Link className="btn" href="/settings#sectors">+ New sector</Link></div>
      <div className="grid cols-3">
        {sectors.map((s) => (
          <Link key={s.id} href={`/sectors/${s.id}`} className="card" style={{ color: "inherit", textDecoration: "none" }}>
            <div style={{ fontSize: "1.8rem" }}>{s.icon}</div>
            <h2 style={{ margin: "6px 0 2px" }}>{s.name}</h2>
            <p className="muted" style={{ fontSize: "0.88rem" }}>{s.description}</p>
            <div className="row">
              <span className="badge">{by[s.id]?.agents ?? 0} agents</span>
              {(by[s.id]?.alerts ?? 0) > 0 && <span className="badge important">{by[s.id].alerts} alerts</span>}
              {(by[s.id]?.approvals ?? 0) > 0 && <span className="badge warn">{by[s.id].approvals} to approve</span>}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

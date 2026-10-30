import Link from "next/link";
import { activity, sectorsList } from "@/lib/queries";
import { ActivityList } from "@/components/blocks";

export const dynamic = "force-dynamic";

export default async function ActivityPage(props: { searchParams: Promise<{ sector?: string; level?: string }> }) {
  const sp = await props.searchParams;
  const [items, sectors] = await Promise.all([activity({ sectorId: sp.sector, level: sp.level, limit: 300 }), sectorsList()]);
  const link = (s?: string, l?: string) => `/activity?${s ? `sector=${s}&` : ""}${l ? `level=${l}` : ""}`;
  return (
    <>
      <div className="pagehead"><h1>Activity log</h1></div>
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <Link className={`badge ${!sp.sector ? "info" : ""}`} href={link(undefined, sp.level)}>all sectors</Link>
          {sectors.map((s) => <Link key={s.id} className={`badge ${sp.sector === s.id ? "info" : ""}`} href={link(s.id, sp.level)}>{s.icon} {s.name}</Link>)}
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          {[undefined, "info", "warn", "error"].map((l) => <Link key={l ?? "all"} className={`badge ${sp.level === l ? "info" : ""}`} href={link(sp.sector, l)}>{l ?? "all levels"}</Link>)}
        </div>
        <ActivityList items={items} />
      </div>
    </>
  );
}

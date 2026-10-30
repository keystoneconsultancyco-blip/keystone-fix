"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav(props: { sectors: { id: string; name: string; icon: string }[]; approvals: number; alerts: number }) {
  const path = usePathname();
  const is = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      <aside className="sidebar">
        <div className="brand"><img src="/icon-192.png" width={26} height={26} alt="" style={{ borderRadius: 7 }} /> Bilal OS</div>
        <nav className="nav">
          <Link href="/" className={is("/") ? "active" : ""}>🏠 Hub</Link>
          <Link href="/approvals" className={is("/approvals") ? "active" : ""}>✅ Approvals {props.approvals > 0 && <span className="count">{props.approvals}</span>}</Link>
          <Link href="/alerts" className={is("/alerts") ? "active" : ""}>🔔 Alerts {props.alerts > 0 && <span className="count">{props.alerts}</span>}</Link>
          <div className="section">Sectors</div>
          {props.sectors.map((s) => (
            <Link key={s.id} href={`/sectors/${s.id}`} className={is(`/sectors/${s.id}`) ? "active" : ""}>{s.icon} {s.name}</Link>
          ))}
          <div className="section">System</div>
          <Link href="/activity" className={is("/activity") ? "active" : ""}>📜 Activity</Link>
          <Link href="/system" className={is("/system") ? "active" : ""}>🩺 Health &amp; spend</Link>
          <Link href="/settings" className={is("/settings") ? "active" : ""}>⚙️ Settings</Link>
          <Link href="/setup" className={is("/setup") ? "active" : ""}>🔑 Setup</Link>
        </nav>
      </aside>
      <nav className="tabbar">
        <Link href="/" className={is("/") ? "active" : ""}><span>🏠</span>Hub</Link>
        <Link href="/approvals" className={is("/approvals") ? "active" : ""}><span>✅</span>Approve{props.approvals ? ` (${props.approvals})` : ""}</Link>
        <Link href="/sectors" className={is("/sectors") ? "active" : ""}><span>🧩</span>Sectors</Link>
        <Link href="/alerts" className={is("/alerts") ? "active" : ""}><span>🔔</span>Alerts{props.alerts ? ` (${props.alerts})` : ""}</Link>
        <Link href="/system" className={is("/system") || is("/settings") || is("/setup") || is("/activity") ? "active" : ""}><span>⚙️</span>More</Link>
      </nav>
    </>
  );
}

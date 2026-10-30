import { requireUser } from "@/lib/auth";
import { sectorsList } from "@/lib/queries";
import { one } from "@/lib/db";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const [sectors, counts] = await Promise.all([
    sectorsList(),
    one<{ approvals: number; alerts: number }>(
      "SELECT (SELECT count(*)::int FROM approvals WHERE status = 'pending') AS approvals, (SELECT count(*)::int FROM alerts WHERE read_at IS NULL AND severity <> 'info') AS alerts",
    ),
  ]);
  return (
    <div className="shell">
      <Nav sectors={sectors} approvals={counts?.approvals ?? 0} alerts={counts?.alerts ?? 0} />
      <main className="main">{children}</main>
    </div>
  );
}

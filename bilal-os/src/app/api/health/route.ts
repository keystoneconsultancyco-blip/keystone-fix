import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Public health check: database reachable and worker heartbeat age. No private data. */
export async function GET() {
  try {
    const hb = await one<{ age: number }>("SELECT extract(epoch from now() - ts)::int AS age FROM heartbeats WHERE service = 'worker'");
    const workerOk = hb !== null && hb.age < 180;
    return Response.json({ ok: true, db: "ok", worker: workerOk ? "ok" : "stale", workerHeartbeatAgeSec: hb?.age ?? null });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}

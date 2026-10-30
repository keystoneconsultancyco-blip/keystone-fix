// Bilal OS worker: the always-on process that runs scheduled agents, the
// Telegram bot and anything the dashboard asks for. Start with `npm run worker`.
import http from "node:http";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { env } from "../src/lib/env";
import { migrate } from "../src/lib/migrate";
import { q, one, pool } from "../src/lib/db";
import { AGENTS, getAgent } from "../src/agents";
import { syncRegistry, resolveSchedule } from "../src/lib/agent/registry-sync";
import { runAgent, handleApproval } from "../src/lib/agent/runner";
import { logActivity } from "../src/lib/activity";
import { startBot, stopBot } from "../src/agents/pa/bot";
import type { AgentDefinition } from "../src/lib/agent/types";

const TZ = "Europe/London";
const queueName = (id: string) => `agent.${id}`;

const boss = new PgBoss({
  connectionString: env.databaseUrl,
  ssl: /sslmode=require/.test(env.databaseUrl) ? { rejectUnauthorized: false } : undefined,
  max: 4,
} as any);
boss.on("error", (e) => console.error("[pg-boss]", e.message));

async function setupAgent(a: AgentDefinition) {
  const name = queueName(a.id);
  const opts = {
    retryLimit: a.retries ?? 2,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 3600,
    expireInSeconds: a.timeoutSeconds ?? 900,
  };
  if (!(await boss.getQueue(name))) await boss.createQueue(name, opts);
  else await boss.updateQueue(name, opts).catch(() => {});

  const cron = await resolveSchedule(a);
  if (cron) await boss.schedule(name, cron, { trigger: "schedule" }, { tz: TZ });
  else await boss.unschedule(name).catch(() => {});
  await q("UPDATE agents SET schedule = $2 WHERE id = $1", [a.id, cron]);
}

async function refreshNextRuns() {
  for (const a of AGENTS) {
    const row = await one<{ schedule: string | null; enabled: boolean }>("SELECT schedule, enabled FROM agents WHERE id = $1", [a.id]);
    let next: Date | null = null;
    if (row?.schedule && row.enabled) {
      try { next = boss.previewSchedule(row.schedule, { tz: TZ, count: 1 } as any)[0] ?? null; } catch { next = null; }
    }
    await q("UPDATE agents SET next_run_at = $2 WHERE id = $1", [a.id, next]);
  }
}

async function setupAll() {
  await syncRegistry();
  for (const a of AGENTS) await setupAgent(a);
  await refreshNextRuns();
}

async function startWorkers() {
  for (const a of AGENTS) {
    await boss.work<{ trigger?: string; input?: Record<string, unknown> }>(queueName(a.id), async ([job]) => {
      const j = job as any;
      await runAgent(a, {
        trigger: job.data?.trigger ?? "schedule",
        input: job.data?.input ?? {},
        attempt: j.retryCount ?? 0,
        maxAttempts: (j.retryLimit ?? 0) + 1,
      });
      await refreshNextRuns().catch(() => {});
    });
  }
}

// ---- Commands from the dashboard (LISTEN/NOTIFY with a polling fallback) ----
let processing = false;
async function processCommands() {
  if (processing) return;
  processing = true;
  try {
    for (;;) {
      const cmd = await one<{ id: number; kind: string; payload: any }>(
        `UPDATE commands SET taken_at = now() WHERE id = (
           SELECT id FROM commands WHERE taken_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
         ) RETURNING id, kind, payload`,
      );
      if (!cmd) break;
      try {
        if (cmd.kind === "agent.run") {
          const a = getAgent(cmd.payload.agentId);
          if (a) await boss.send(queueName(a.id), { trigger: cmd.payload.trigger ?? "manual", input: cmd.payload.input ?? {} });
        } else if (cmd.kind === "approval.decided") {
          const ap = await one<{ agent_id: string }>("SELECT agent_id FROM approvals WHERE id = $1", [cmd.payload.id]);
          const a = ap && getAgent(ap.agent_id);
          if (a) await handleApproval(a, cmd.payload.id);
        } else if (cmd.kind === "registry.sync") {
          await setupAll();
        }
      } catch (e) {
        await logActivity({ level: "error", message: `Command ${cmd.kind} failed: ${(e as Error).message}` });
      }
    }
    await q("DELETE FROM commands WHERE taken_at < now() - interval '7 days'");
  } finally {
    processing = false;
  }
}

async function listen() {
  const client = new pg.Client({ connectionString: env.databaseUrl, ssl: /sslmode=require/.test(env.databaseUrl) ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  await client.query("LISTEN bilalos_cmd");
  client.on("notification", () => void processCommands());
  client.on("error", (e) => {
    console.error("[listen] connection lost, reconnecting", e.message);
    setTimeout(() => void listen().catch(() => {}), 5000);
  });
}

async function heartbeat() {
  const mem = process.memoryUsage();
  await q(
    `INSERT INTO heartbeats (service, ts, info) VALUES ('worker', now(), $1)
     ON CONFLICT (service) DO UPDATE SET ts = now(), info = EXCLUDED.info`,
    [JSON.stringify({ rssMb: Math.round(mem.rss / 1e6), uptimeSec: Math.round(process.uptime()), agents: AGENTS.length })],
  );
}

async function housekeeping() {
  // Keep the database small: old logs and runs are not needed forever.
  await q("DELETE FROM activity_log WHERE ts < now() - interval '90 days'");
  await q("DELETE FROM agent_runs WHERE started_at < now() - interval '90 days'");
  await q("DELETE FROM login_attempts WHERE ts < now() - interval '30 days'");
  await q("DELETE FROM sessions WHERE expires_at < now()");
  await q("DELETE FROM telegram_messages WHERE ts < now() - interval '60 days'");
}

// Tiny HTTP server so the platform health check works for the worker too.
function healthServer() {
  const port = Number(process.env.PORT ?? 0);
  if (!port) return;
  http.createServer(async (req, res) => {
    let ok = true;
    try { await q("SELECT 1"); } catch { ok = false; }
    res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok, service: "worker", uptimeSec: Math.round(process.uptime()) }));
  }).listen(port, () => console.log(`[worker] health server on :${port}`));
}

async function main() {
  console.log("[worker] starting");
  healthServer();
  const applied = await migrate();
  if (applied.length) console.log("[worker] migrations applied:", applied.join(", "));
  await boss.start();
  await setupAll();
  await startWorkers();
  await listen();
  await processCommands();
  await heartbeat();
  setInterval(() => void heartbeat().catch((e) => console.error("[heartbeat]", e.message)), 60_000);
  setInterval(() => void processCommands(), 30_000);
  setInterval(() => void refreshNextRuns().catch(() => {}), 10 * 60_000);
  setInterval(() => void housekeeping().catch(() => {}), 6 * 3600_000);
  await startBot().catch((e) => console.error("[bot] failed to start:", e.message));
  await logActivity({ level: "info", message: `Worker started with ${AGENTS.length} agents` });
  console.log(`[worker] ready — ${AGENTS.length} agents registered`);
}

async function shutdown(sig: string) {
  console.log(`[worker] ${sig} received, stopping`);
  await stopBot().catch(() => {});
  await boss.stop({ graceful: true, timeout: 20_000 } as any).catch(() => {});
  await pool().end().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (e) => console.error("[worker] unhandled rejection", e));

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});

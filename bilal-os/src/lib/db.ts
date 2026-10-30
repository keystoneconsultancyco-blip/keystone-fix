import pg from "pg";
import { env } from "./env";

// Return timestamps as JS Dates and bigint ids as numbers (safe for our volumes).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

const g = globalThis as unknown as { __bilalPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!g.__bilalPool) {
    g.__bilalPool = new pg.Pool({
      connectionString: env.databaseUrl,
      max: Number(process.env.PG_POOL_MAX ?? 5),
      ssl: /sslmode=require/.test(env.databaseUrl) ? { rejectUnauthorized: false } : undefined,
    });
    g.__bilalPool.on("error", (err) => console.error("[db] idle client error", err.message));
  }
  return g.__bilalPool;
}

export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query<T>(text, params as any[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

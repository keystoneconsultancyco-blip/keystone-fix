import { q } from "./db";

/** Ask the worker to do something (used by the dashboard, which can't run jobs itself). */
export async function sendCommand(kind: "agent.run" | "approval.decided" | "registry.sync", payload: Record<string, unknown> = {}) {
  await q("INSERT INTO commands (kind, payload) VALUES ($1, $2)", [kind, JSON.stringify(payload)]);
  await q("NOTIFY bilalos_cmd");
}

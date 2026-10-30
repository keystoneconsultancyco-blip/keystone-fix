import { q, one } from "./db";
import { getSetting, setSetting } from "./settings";
import { raiseAlert } from "./alerts";
import { londonParts, fromLondon } from "./time";

export function monthStart(now = new Date()): Date {
  const p = londonParts(now);
  return fromLondon(p.year, p.month, 1);
}

export async function spendThisMonthGbp(): Promise<number> {
  const row = await one<{ total: number | null }>("SELECT sum(cost_gbp) AS total FROM llm_usage WHERE ts >= $1", [monthStart()]);
  return Number(row?.total ?? 0);
}

export async function costStatus() {
  const [spent, cap, warnAt] = await Promise.all([spendThisMonthGbp(), getSetting("cost.monthlyCapGbp"), getSetting("cost.warnAtPercent")]);
  const pct = cap > 0 ? (spent / cap) * 100 : 0;
  return { spent, cap, pct, warnAt, paused: pct >= 100, warning: pct >= warnAt };
}

export async function priceGbp(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }): Promise<number> {
  const prices = await getSetting("llm.prices");
  const rate = await getSetting("llm.usdToGbp");
  // Unknown model: assume the most expensive configured price so we never under-count.
  const p = prices[model] ?? Object.values(prices).reduce((a, b) => (b[1] > a[1] ? b : a), [5, 25, 0.5, 6.25]);
  const usd = (u.input * p[0] + u.output * p[1] + u.cacheRead * (p[2] ?? p[0] * 0.1) + u.cacheWrite * (p[3] ?? p[0] * 1.25)) / 1_000_000;
  return usd * rate;
}

/** Called after every LLM call. Records cost and fires the 80% / 100% Telegram notices once per month. */
export async function recordUsage(r: { agentId?: string | null; model: string; purpose?: string; input: number; output: number; cacheRead: number; cacheWrite: number }) {
  const cost = await priceGbp(r.model, r);
  await q(
    `INSERT INTO llm_usage (agent_id, model, purpose, input_tokens, output_tokens, cache_read, cache_write, cost_gbp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [r.agentId ?? null, r.model, r.purpose ?? null, r.input, r.output, r.cacheRead, r.cacheWrite, cost],
  );
  await checkThresholds();
  return cost;
}

export async function checkThresholds() {
  const s = await costStatus();
  const month = `${londonParts().year}-${londonParts().month}`;
  if (s.pct >= 100) {
    await raiseAlert({
      sectorId: "pa", severity: "crucial", dedupeKey: `cost-cap-${month}`,
      title: `AI budget reached: £${s.spent.toFixed(2)} of £${s.cap.toFixed(2)}`,
      body: "Non-essential AI jobs are paused until the 1st of next month. Essential jobs (like your morning briefing) keep running without AI. You can raise the cap on the PA settings page.",
    });
  } else if (s.warning) {
    await raiseAlert({
      sectorId: "pa", severity: "important", dedupeKey: `cost-warn-${month}`,
      title: `AI spend at ${Math.round(s.pct)}% of this month's budget`,
      body: `£${s.spent.toFixed(2)} of £${s.cap.toFixed(2)} used.`,
    });
  }
}

export async function setMonthlyCap(gbp: number) {
  await setSetting("cost.monthlyCapGbp", gbp);
}

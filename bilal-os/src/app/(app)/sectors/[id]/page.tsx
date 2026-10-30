import Link from "next/link";
import { notFound } from "next/navigation";
import { one } from "@/lib/db";
import { agentsFor, activity, openAlerts } from "@/lib/queries";
import { pendingApprovals } from "@/lib/approvals";
import { AGENTS, getSectorDef } from "@/agents";
import type { Kpi } from "@/lib/agent/types";
import { KpiCards, AlertsList, ApprovalsList, AgentsTable, ActivityList } from "@/components/blocks";
import { ActionButton, InlineField } from "@/components/ui";
import { readAllAlertsAction, saveAgentConfigAction, deleteSectorAction } from "../../../actions";
import { SECTOR_PANELS } from "@/components/sector-panels";

export const dynamic = "force-dynamic";

const TABS = ["overview", "agents", "activity", "settings"] as const;

async function collectKpis(sectorId: string): Promise<Kpi[]> {
  const out: Kpi[] = [];
  const def = getSectorDef(sectorId);
  const safe = async (fn?: () => Promise<Kpi[]>) => { try { if (fn) out.push(...(await fn())); } catch (e) { out.push({ label: "KPI error", value: "!", hint: (e as Error).message, tone: "bad" }); } };
  await safe(def?.kpis);
  for (const a of AGENTS.filter((x) => x.sector === sectorId)) await safe(a.kpis);
  return out;
}

export default async function SectorPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; agent?: string; level?: string }> }) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "overview";
  const sector = await one<{ id: string; name: string; icon: string; description: string | null; builtin: boolean }>("SELECT * FROM sectors WHERE id = $1", [id]);
  if (!sector) notFound();
  const agents = await agentsFor(id);
  const Panel = SECTOR_PANELS[id];

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{sector.icon} {sector.name}</h1>
          <div className="muted">{sector.description}</div>
        </div>
      </div>
      <nav className="tabs">
        {TABS.map((t) => <Link key={t} href={`/sectors/${id}?tab=${t}`} className={t === tab ? "active" : ""}>{t[0].toUpperCase() + t.slice(1)}</Link>)}
      </nav>

      {tab === "overview" && <Overview id={id} Panel={Panel} />}
      {tab === "agents" && <AgentsTable agents={agents} />}
      {tab === "activity" && <ActivityTab id={id} agent={sp.agent} level={sp.level} agents={agents.map((a) => ({ id: a.id, name: a.name }))} />}
      {tab === "settings" && <SettingsTab id={id} builtin={sector.builtin} agents={agents} />}
    </>
  );
}

async function Overview({ id, Panel }: { id: string; Panel?: (p: { sectorId: string }) => Promise<React.ReactNode> }) {
  const [kpis, alerts, approvals] = await Promise.all([collectKpis(id), openAlerts(id), pendingApprovals(id)]);
  return (
    <div className="stack">
      <KpiCards kpis={kpis} />
      {Panel && <Panel sectorId={id} />}
      <div className="grid cols-2">
        <section className="card">
          <div className="card-head"><h2>Alerts</h2>{alerts.length > 0 && <ActionButton className="small" action={readAllAlertsAction.bind(null, id)}>Clear all</ActionButton>}</div>
          <AlertsList alerts={alerts} />
        </section>
        <section className="card">
          <div className="card-head"><h2>Approvals</h2></div>
          <ApprovalsList approvals={approvals} />
        </section>
      </div>
    </div>
  );
}

async function ActivityTab({ id, agent, level, agents }: { id: string; agent?: string; level?: string; agents: { id: string; name: string }[] }) {
  const items = await activity({ sectorId: id, agentId: agent, level, limit: 200 });
  const link = (a?: string, l?: string) => `/sectors/${id}?tab=activity${a ? `&agent=${a}` : ""}${l ? `&level=${l}` : ""}`;
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <small className="muted">Agent:</small>
        <Link className={`badge ${!agent ? "info" : ""}`} href={link(undefined, level)}>all</Link>
        {agents.map((a) => <Link key={a.id} className={`badge ${agent === a.id ? "info" : ""}`} href={link(a.id, level)}>{a.name}</Link>)}
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <small className="muted">Level:</small>
        {[undefined, "info", "warn", "error"].map((l) => <Link key={l ?? "all"} className={`badge ${level === l ? "info" : ""}`} href={link(agent, l)}>{l ?? "all"}</Link>)}
      </div>
      <ActivityList items={items} />
    </div>
  );
}

function SettingsTab({ id, builtin, agents }: { id: string; builtin: boolean; agents: Awaited<ReturnType<typeof agentsFor>> }) {
  const defs = AGENTS.filter((a) => a.sector === id);
  return (
    <div className="stack">
      {defs.length === 0 && <div className="card empty">No agents yet, so nothing to configure.</div>}
      {defs.map((d) => {
        const row = agents.find((a) => a.id === d.id);
        return (
          <section className="card" key={d.id}>
            <h2>{d.name}</h2>
            <p className="muted">{d.description}</p>
            <p className="help">Schedule: {row?.schedule ? <code>{row.schedule}</code> : "on demand"} (UK time) · Permissions: {d.permissions.join(", ") || "none"}</p>
            {d.approvals?.length ? (
              <div className="help">Needs your approval before: {d.approvals.map((a) => a.description).join("; ")}</div>
            ) : null}
            {d.settings?.map((s) => (
              <InlineField
                key={s.key}
                label={s.label}
                help={s.help}
                type={s.type}
                value={(row?.config?.[s.key] ?? s.default) as any}
                save={saveAgentConfigAction.bind(null, d.id, s.key)}
              />
            ))}
          </section>
        );
      })}
      {!builtin && (
        <section className="card">
          <h2>Delete sector</h2>
          <p className="muted">Only possible while it has no agents.</p>
          <ActionButton className="danger" confirm="Delete this sector?" action={deleteSectorAction.bind(null, id)}>Delete sector</ActionButton>
        </section>
      )}
    </div>
  );
}

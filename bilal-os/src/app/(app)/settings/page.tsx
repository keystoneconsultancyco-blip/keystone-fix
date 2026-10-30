import { getAllSettings } from "@/lib/settings";
import { sectorsList } from "@/lib/queries";
import { ActionButton, ActionForm, InlineField } from "@/components/ui";
import { saveSettingAction, addSectorAction, logoutAction, signOutEverywhereAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const s = await getAllSettings();
  const sectors = await sectorsList();
  const f = (key: string, label: string, type: "string" | "number" | "time" | "boolean" = "string", help?: string) => (
    <InlineField key={key} label={label} type={type} value={s[key] as any} help={help} save={saveSettingAction.bind(null, key)} />
  );
  return (
    <>
      <div className="pagehead"><h1>Settings</h1></div>
      <div className="grid cols-2">
        <section className="card">
          <h2>💷 AI budget</h2>
          {f("cost.monthlyCapGbp", "Monthly cap (£)", "number", "At 100% non-essential AI jobs pause until the 1st.")}
          {f("cost.warnAtPercent", "Warn me at (%)", "number")}
          {f("llm.usdToGbp", "US$ → £ rate", "number", "Anthropic prices are in dollars.")}
        </section>
        <section className="card">
          <h2>🤖 AI models</h2>
          {f("llm.fastModel", "Fast model (briefings, sorting, summaries)", "string")}
          {f("llm.strongModel", "Strong model (applications, module guides)", "string")}
          <p className="help">Prices per model live in the <code>llm.prices</code> setting (edit in code: <code>src/lib/settings.ts</code>).</p>
        </section>
        <section className="card">
          <h2>🧭 Daily rhythm</h2>
          {f("pa.briefingTime", "Morning briefing", "time")}
          {f("pa.wrapupTime", "Evening wrap-up", "time")}
          {f("general.quietHoursStart", "Quiet hours start", "time", "Only crucial alerts reach Telegram during quiet hours.")}
          {f("general.quietHoursEnd", "Quiet hours end", "time")}
        </section>
        <section className="card" id="sectors">
          <h2>🧩 Add a sector</h2>
          <p className="help">Creates an empty sector page. Ask Claude Code to add agents to it later (see docs/ADDING_AN_AGENT.md).</p>
          <ActionForm action={addSectorAction} submit="Create sector" resetOnSuccess>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input name="icon" placeholder="🧪" style={{ maxWidth: 70 }} />
              <input name="name" placeholder="Sector name" required />
            </div>
          </ActionForm>
          <p className="help" style={{ marginTop: 10 }}>Current: {sectors.map((x) => `${x.icon} ${x.name}`).join(" · ")}</p>
        </section>
        <section className="card">
          <h2>🔐 Sessions</h2>
          <div className="row">
            <ActionButton action={logoutAction}>Sign out</ActionButton>
            <ActionButton className="danger" confirm="Sign out on every device?" action={signOutEverywhereAction}>Sign out everywhere</ActionButton>
          </div>
        </section>
      </div>
    </>
  );
}

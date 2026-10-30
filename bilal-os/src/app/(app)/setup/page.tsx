import { SECRET_DEFS, secretStatus } from "@/lib/settings";
import { isGoogleConnected, redirectUri } from "@/lib/google";
import { relative } from "@/lib/time";
import { ActionButton, InlineField } from "@/components/ui";
import { saveSecretAction, deleteSecretAction, testAnthropicAction, testTelegramAction } from "../../actions";
import { TelegramPair } from "./TelegramPair";

export const dynamic = "force-dynamic";

function SecretRow({ k, status }: { k: keyof typeof SECRET_DEFS; status: { set: boolean; hint: string | null; updatedAt: string | null } }) {
  const def = SECRET_DEFS[k];
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6, marginTop: 6 }}>
      <InlineField
        label={`${def.label} ${status.set ? "✅" : "—"}`}
        type="password"
        value=""
        placeholder={status.set ? `Saved (${status.hint}). Type to replace.` : "Paste here"}
        help={`${def.help}${status.updatedAt ? ` · updated ${relative(status.updatedAt)}` : ""}`}
        save={saveSecretAction.bind(null, k)}
      />
      {status.set && <div style={{ marginTop: 4 }}><ActionButton className="small danger" confirm="Remove this credential?" action={deleteSecretAction.bind(null, k)}>Remove</ActionButton></div>}
    </div>
  );
}

export default async function SetupPage() {
  const [s, google] = await Promise.all([secretStatus(), isGoogleConnected()]);
  const steps = [
    { done: s.anthropic_api_key.set, label: "Anthropic API key" },
    { done: s.telegram_chat_id.set, label: "Telegram linked" },
    { done: google, label: "Google connected" },
    { done: s.moodle_username.set && s.moodle_password.set, label: "RHUL login" },
  ];
  return (
    <>
      <div className="pagehead">
        <div><h1>Setup</h1><div className="muted">Everything is stored encrypted. Secrets are never shown again in full.</div></div>
      </div>
      <div className="card row" style={{ marginBottom: 14 }}>
        {steps.map((st) => <span key={st.label} className={`badge ${st.done ? "good" : "warn"}`}>{st.done ? "✓" : "•"} {st.label}</span>)}
      </div>
      <div className="grid cols-2">
        <section className="card">
          <h2>1 · Anthropic (AI)</h2>
          <p className="help">Pay-as-you-go API key — separate from your Claude app subscription. Spend is capped on the Settings page.</p>
          <SecretRow k="anthropic_api_key" status={s.anthropic_api_key} />
          <div style={{ marginTop: 10 }}><ActionButton action={testAnthropicAction}>Test AI connection</ActionButton></div>
        </section>

        <section className="card">
          <h2>2 · Telegram</h2>
          <p className="help">Create a bot with @BotFather, paste its token, then link it to your Telegram account.</p>
          <SecretRow k="telegram_bot_token" status={s.telegram_bot_token} />
          <div className="stack" style={{ marginTop: 10 }}>
            <TelegramPair linked={s.telegram_chat_id.set} />
            {s.telegram_chat_id.set && <ActionButton action={testTelegramAction}>Send test message</ActionButton>}
          </div>
        </section>

        <section className="card">
          <h2>3 · Google Calendar &amp; Drive</h2>
          <p className="help">Create an OAuth client (type “Web application”) in Google Cloud and add this redirect URI:</p>
          <pre className="pre">{redirectUri()}</pre>
          <SecretRow k="google_client_id" status={s.google_client_id} />
          <SecretRow k="google_client_secret" status={s.google_client_secret} />
          <div className="row" style={{ marginTop: 10 }}>
            <a className="btn primary" href="/api/google/connect">{google ? "Reconnect Google" : "Connect Google"}</a>
            {google && <span className="badge good">connected</span>}
          </div>
        </section>

        <section className="card">
          <h2>4 · Royal Holloway login</h2>
          <p className="help">Used only by the Moodle and timetable agents, in a private browser on your server. If your login uses Microsoft Authenticator, approve the first sign-in on your phone when the bot asks.</p>
          <SecretRow k="moodle_username" status={s.moodle_username} />
          <SecretRow k="moodle_password" status={s.moodle_password} />
        </section>
      </div>
    </>
  );
}

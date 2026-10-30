import { redirect } from "next/navigation";
import { sessionState } from "@/lib/auth";
import { ActionForm } from "@/components/ui";
import { totpAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function TwoFactorPage() {
  const st = await sessionState();
  if (st === "none") redirect("/login");
  if (st === "ok") redirect("/");
  if (st === "needs-enrol") redirect("/login/enrol");
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Two-step check</h1>
        <p className="muted">Open your authenticator app and type the 6-digit code for Bilal OS.</p>
        <ActionForm action={totpAction} submit="Verify">
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus placeholder="123 456" />
        </ActionForm>
      </div>
    </div>
  );
}

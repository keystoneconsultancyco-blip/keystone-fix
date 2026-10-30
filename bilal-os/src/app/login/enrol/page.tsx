import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { sessionState } from "@/lib/auth";
import { ActionForm } from "@/components/ui";
import { enrolConfirmAction, enrolStartAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EnrolPage() {
  const st = await sessionState();
  if (st === "none") redirect("/login");
  if (st !== "needs-enrol") redirect("/");
  const uri = await enrolStartAction();
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
  const secret = new URL(uri).searchParams.get("secret");
  return (
    <div className="auth-wrap">
      <div className="card auth-card stack">
        <h1>Set up two-step login</h1>
        <p className="muted">
          Install an authenticator app (Google Authenticator, Microsoft Authenticator, or iPhone Passwords → Verification codes).
          Scan this code, then type the 6-digit number it shows.
        </p>
        <img src={qr} alt="QR code for your authenticator app" width={240} height={240} style={{ background: "#fff", borderRadius: 12, padding: 8 }} />
        <p className="help">Can&apos;t scan? Enter this key manually: <code>{secret}</code></p>
        <ActionForm action={enrolConfirmAction} submit="Turn on two-step login">
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required placeholder="123 456" />
        </ActionForm>
      </div>
    </div>
  );
}

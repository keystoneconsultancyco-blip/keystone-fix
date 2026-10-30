import { redirect } from "next/navigation";
import { userExists, sessionState } from "@/lib/auth";
import { ActionForm } from "@/components/ui";
import { loginAction, signupAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const exists = await userExists();
  if (exists && (await sessionState()) === "ok") redirect("/");
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Bilal OS</h1>
        {exists ? (
          <ActionForm action={loginAction} submit="Sign in">
            <label htmlFor="pw">Password</label>
            <input id="pw" name="password" type="password" autoComplete="current-password" required autoFocus />
          </ActionForm>
        ) : (
          <>
            <p className="muted">First visit: create your password. Only you will ever use this dashboard.</p>
            <ActionForm action={signupAction} submit="Create account">
              <label htmlFor="pw">New password (12+ characters)</label>
              <input id="pw" name="password" type="password" autoComplete="new-password" minLength={12} required />
              <label htmlFor="pw2">Type it again</label>
              <input id="pw2" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
            </ActionForm>
          </>
        )}
      </div>
    </div>
  );
}

import { cookies } from "next/headers";
import { apiGuard } from "@/lib/auth";
import { authUrl } from "@/lib/google";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await apiGuard();
  if (denied) return Response.redirect(`${env.appUrl}/login`);
  const state = randomToken(16);
  (await cookies()).set("g_state", state, { httpOnly: true, secure: env.isProd, sameSite: "lax", maxAge: 600, path: "/" });
  const url = await authUrl(state);
  if (!url) return new Response("Save your Google client ID and secret on the Setup page first.", { status: 400 });
  return Response.redirect(url);
}

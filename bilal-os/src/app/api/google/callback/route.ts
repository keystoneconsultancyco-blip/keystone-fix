import { cookies } from "next/headers";
import { apiGuard } from "@/lib/auth";
import { exchangeCode } from "@/lib/google";
import { env } from "@/lib/env";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await apiGuard();
  if (denied) return Response.redirect(`${env.appUrl}/login`);
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("g_state")?.value;
  jar.delete("g_state");
  if (!expected || url.searchParams.get("state") !== expected) return new Response("State mismatch — please try Connect Google again.", { status: 400 });
  const code = url.searchParams.get("code");
  if (!code) return new Response(`Google said: ${url.searchParams.get("error") ?? "no code"}`, { status: 400 });
  try {
    await exchangeCode(code);
    await logActivity({ sectorId: "pa", message: "Google connected" });
  } catch (e) {
    return new Response(`Couldn't connect Google: ${(e as Error).message}`, { status: 400 });
  }
  return Response.redirect(`${env.appUrl}/setup`);
}

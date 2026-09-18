import { NextRequest, NextResponse } from "next/server";
import { catchUpPlayback } from "@/lib/sim/engine";
import { isSystemPaused } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const passed = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-cron-secret") ?? bearer;
  if (!secret || passed !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (await isSystemPaused()) return NextResponse.json({ ok: true, paused: true });
  const sim = await catchUpPlayback();
  return NextResponse.json({ ok: true, playing: sim.playing, completed: sim.completed });
}

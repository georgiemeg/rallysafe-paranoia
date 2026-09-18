import { NextRequest, NextResponse } from "next/server";
import { scanAndNotifySportity } from "@/lib/sportity";
import { isSystemPaused } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const passed = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-cron-secret") ?? bearer;
  return passed === secret;
}

// Poll the Sportity event bulletin for new documents (bulletins, steward decisions,
// schedule changes) and Telegram the owner when something new appears. Point a
// cron-job.org job at this every ~15 minutes during the event.
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (await isSystemPaused()) {
    return NextResponse.json({ ok: true, paused: true });
  }
  try {
    const { newDocs, total } = await scanAndNotifySportity();
    return NextResponse.json({ ok: true, total, newDocs });
  } catch (err) {
    console.error("sportity scan failed", err);
    return NextResponse.json({ error: "scan failed" }, { status: 502 });
  }
}

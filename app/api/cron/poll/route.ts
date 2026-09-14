import { NextRequest, NextResponse } from "next/server";
import { getActiveEventIds } from "@/lib/store";
import { processWatchedEvent } from "@/lib/rally-poll";
import { TEST_EVENT_ID } from "@/lib/sim/ids";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function cronAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const passed = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-cron-secret") ?? bearer;
  return passed === secret;
}

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown>[] = [];
  const activeEventIds = (await getActiveEventIds()).filter((id) => id !== TEST_EVENT_ID);
  for (const eventId of activeEventIds) {
    results.push(...(await processWatchedEvent(eventId)));
  }
  return NextResponse.json({ ok: true, sentBatches: results.length, results });
}

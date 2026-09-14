import { NextRequest, NextResponse } from "next/server";
import { getEwrcFullEvent, refineFullyCancelledStages, deriveServiceTimes } from "@/lib/ewrc-full";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Comprehensive finished-event results: real classified standings, real penalties with
// reasons, real retirements with reasons, real schedule/service windows, real stage
// lengths, and real per-stage cancellation status (distinguishing a genuine full
// cancellation from a partial/scratch-timed one per RCR 5.14) — all sourced from eWRC,
// which is the correct single source of truth once an event has actually finished.
export async function GET(req: NextRequest) {
  const eventId = Number(req.nextUrl.searchParams.get("eventId"));
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "Missing eventId" }, { status: 400 });
  }

  const data = await getEwrcFullEvent(eventId);
  if (!data) return NextResponse.json({ error: "No eWRC results available for this event." }, { status: 404 });

  const entryIds = data.standings.map((s) => s.entryId).filter((id) => id > 0);
  const [refinedStages, derivedServiceTimes] = await Promise.all([
    refineFullyCancelledStages(eventId, entryIds, data.stages),
    deriveServiceTimes(eventId, entryIds, data.stages, data.serviceWindows).catch(() => []),
  ]);

  return NextResponse.json({ ...data, stages: refinedStages, derivedServiceTimes });
}

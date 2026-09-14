import { NextRequest, NextResponse } from "next/server";
import { getEwrcCarStages } from "@/lib/ewrc-full";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Real per-car stage-by-stage times + running totals + real per-stage cancellation flag,
// straight from eWRC, for the click-to-expand stage breakdown on a finished event's
// results row.
export async function GET(req: NextRequest) {
  const eventId = Number(req.nextUrl.searchParams.get("eventId"));
  const entryId = Number(req.nextUrl.searchParams.get("entryId"));
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(entryId) || entryId <= 0) {
    return NextResponse.json({ error: "Missing eventId or entryId" }, { status: 400 });
  }
  const data = await getEwrcCarStages(eventId, entryId);
  if (!data) return NextResponse.json({ error: "No stage times found for this entry." }, { status: 404 });
  return NextResponse.json(data);
}

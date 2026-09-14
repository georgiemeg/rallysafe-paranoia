import { NextRequest, NextResponse } from "next/server";
import { getEwrcEntryStages, getEwrcFinalStandings } from "@/lib/ewrc-results";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const eventId = Number(req.nextUrl.searchParams.get("eventId"));
  const entryId = Number(req.nextUrl.searchParams.get("entryId"));
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "Missing eventId" }, { status: 400 });
  }
  if (Number.isFinite(entryId) && entryId > 0) {
    const pack = await getEwrcEntryStages(eventId, entryId);
    if (!pack) return NextResponse.json({ error: "No stage times" }, { status: 404 });
    return NextResponse.json(pack);
  }
  const data = await getEwrcFinalStandings(eventId);
  if (!data) return NextResponse.json({ error: "No eWRC results yet." }, { status: 404 });
  return NextResponse.json(data);
}

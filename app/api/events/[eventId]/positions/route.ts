import { NextRequest, NextResponse } from "next/server";
import { getEntries } from "@/lib/rallysafe";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  const id = Number(eventId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
  }
  try {
    const entries = await getEntries(id);
    const positions = entries
      .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng) && !(e.lat === 0 && e.lng === 0))
      .map((e) => ({
        entryId: e.entryId,
        identifier: e.identifier,
        lat: e.lat,
        lon: e.lng,
        speed: e.speed,
        heading: e.bearing,
        status: e.racingStatus,
        stageNumber: e.stageNumber,
        updatedAt: e.lastMessageTimestamp,
      }));
    return NextResponse.json({ positions });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch positions" }, { status: 502 });
  }
}

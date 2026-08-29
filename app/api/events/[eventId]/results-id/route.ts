import { NextRequest, NextResponse } from "next/server";
import { getResultsEventId } from "@/lib/rallysafe";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  const id = Number(eventId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
  }
  try {
    const resultsEventId = await getResultsEventId(id);
    if (!resultsEventId) {
      return NextResponse.json({ error: "No results URL for this event" }, { status: 404 });
    }
    return NextResponse.json({ resultsEventId });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to resolve results event" }, { status: 502 });
  }
}

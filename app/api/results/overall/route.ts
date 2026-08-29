import { NextRequest, NextResponse } from "next/server";
import { findCombinerEventByName, computeOverallStandings } from "@/lib/combiner";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const eventName = req.nextUrl.searchParams.get("eventName");
  if (!eventName) {
    return NextResponse.json({ error: "eventName query param required" }, { status: 400 });
  }

  try {
    const data = await findCombinerEventByName(eventName);
    if (!data) {
      return NextResponse.json(
        { error: "No live overall-time data found for this event yet." },
        { status: 404 }
      );
    }
    const standings = computeOverallStandings(data);
    return NextResponse.json({
      title: data.title,
      stages: data.stages.map((s) => ({ name: s.name, status: s.status, length: s.length })),
      standings,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch overall standings." }, { status: 502 });
  }
}

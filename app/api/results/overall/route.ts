import { NextRequest, NextResponse } from "next/server";
import { findCombinerEventByName, computeOverallStandings } from "@/lib/combiner";
import { getActiveServiceDurationsCsv } from "@/lib/sportity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const eventName = req.nextUrl.searchParams.get("eventName");
  if (!eventName) {
    return NextResponse.json({ error: "eventName query param required" }, { status: 400 });
  }
  if (/test event/i.test(eventName) || /TEST_OTR/i.test(eventName)) {
    const { canSeeTestEvent } = await import("@/lib/dev-auth");
    if (!(await canSeeTestEvent())) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { simOverall } = await import("@/lib/sim/engine");
    return NextResponse.json(await simOverall());
  }

  try {
    const data = await findCombinerEventByName(eventName);
    if (!data) {
      return NextResponse.json(
        { error: "No live overall-time data found for this event yet." },
        { status: 404 }
      );
    }
    const standings = await computeOverallStandings(data);
    const stagesCompleted = standings.reduce((m, r) => Math.max(m, r.stagesCompleted || 0), 0);
    return NextResponse.json({
      title: data.title,
      stages: data.stages.map((s) => ({ name: s.name, status: s.status, length: s.length })),
      standings,
      serviceIn: data.serviceIn,
      timeZone: data.timeZone,
      stagesCompleted,
      serviceDurationsCsv: await getActiveServiceDurationsCsv(),
      source: "combiner",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch overall standings." }, { status: 502 });
  }
}

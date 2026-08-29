import { NextResponse } from "next/server";
import { listEvents } from "@/lib/rallysafe";
import { findCombinerEventByName } from "@/lib/combiner";

export const dynamic = "force-dynamic";

interface RSEvent {
  eventId: number;
  name: string;
}

export async function GET() {
  try {
    const events: RSEvent[] = await listEvents({ take: 50 });

    let active: RSEvent | null = null;
    const araEventIds: number[] = [];
    for (const ev of events) {
      const combinerData = await findCombinerEventByName(ev.name);
      if (combinerData) {
        araEventIds.push(ev.eventId);
        if (!active) active = ev;
      }
    }

    return NextResponse.json({
      events,
      activeEventId: active ? active.eventId : events[0]?.eventId ?? null,
      araEventIds,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 502 });
  }
}

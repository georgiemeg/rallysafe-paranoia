import { NextRequest, NextResponse } from "next/server";
import { getEntries, listStages } from "@/lib/rallysafe";
import { computeRcOverallStandings } from "@/lib/rallysafe-rc-overall";

export const dynamic = "force-dynamic";

/**
 * Universal fallback Overall (Live) standings for non-ARA events (and any ARA event too,
 * as a backup), built entirely from RallySafe's public live-tracking feed
 * (rc.statusas.com — the same cookie-authenticated, no-login-required system already used
 * for the live map and entry lists). This works for ANY event with completed stages,
 * unlike the ARA-only Sneak Attack Rally combiner feed and unlike results-api.statusas.com
 * (which 401s unless the event organizer made their results page public).
 *
 * Trade-off vs the combiner feed: no predicted service times here (that data only exists
 * in the ARA combiner), so Service Estimates alerts stay ARA-only regardless of which
 * overall-standings source is used.
 */
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
    const [entries, stages] = await Promise.all([getEntries(id), listStages(id)]);

    if (stages.length === 0) {
      return NextResponse.json(
        { error: "No stage itinerary found for this event yet." },
        { status: 404 }
      );
    }

    const entriesByIdentifier = new Map<string, { carClass: string; carModel: string }>();
    for (const e of entries) {
      entriesByIdentifier.set(e.identifier, {
        carClass: e.classText ?? "",
        carModel: e.vehicle?.make ?? "",
      });
    }

    const { standings, stagesCompleted } = await computeRcOverallStandings(stages, entriesByIdentifier);

    if (standings.length === 0) {
      return NextResponse.json(
        { error: "No stage has finished yet — overall standings appear once the first stage completes." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      stages: stages
        .filter((s) => !s.isTransit)
        .map((s) => ({ name: s.name, status: s.status === 4 ? "Completed" : "Pending", length: s.length })),
      standings,
      serviceIn: [], // this feed doesn't expose service predictions — ARA combiner does
      timeZone: "",
      stagesCompleted,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch overall standings from RallySafe's live feed." },
      { status: 502 }
    );
  }
}

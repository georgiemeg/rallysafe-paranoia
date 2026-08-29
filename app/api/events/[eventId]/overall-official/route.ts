import { NextRequest, NextResponse } from "next/server";
import { getResultsEventId } from "@/lib/rallysafe";
import {
  getMainRallyId,
  getStages,
  getEntries,
  getStageResults,
  latestCompletedStage,
} from "@/lib/rallysafe-official";

export const dynamic = "force-dynamic";

// Same shape as lib/combiner.ts's OverallStanding, so the Results page can render both
// with the exact same table/JSX — just fed from a different upstream source.
interface OverallStanding {
  position: number;
  number: number;
  carClass: string;
  carModel: string;
  driverName: string;
  codriverName: string;
  stagesCompleted: number;
  totalMs: number;
  gapToLeaderMs: number;
  gapToAheadMs: number;
  isRetired: boolean;
  isPenalized: boolean;
  penaltySecondsNet: number;
}

/**
 * Universal fallback Overall (Live) standings, built from RallySafe's official public
 * results API (results-api.statusas.com) rather than the ARA-only Sneak Attack Rally
 * combiner feed. Works for ANY event with a results page linked on RallySafe — the
 * combiner feed only has data for ARA-sanctioned rallies, so non-ARA events previously
 * showed nothing at all on this tab. This route is the fix for that gap.
 *
 * Trade-off: this source only exposes the latest completed stage's *cumulative* totals
 * (not a stage-by-stage history), so stagesCompleted here just reflects how many stages
 * the event itself has run so far, not a per-entry breakdown. Good enough for a live
 * "where does everyone stand right now" table, which is what this tab is for.
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
    const resultsEventId = await getResultsEventId(id);
    if (!resultsEventId) {
      return NextResponse.json(
        { error: "This event has no results page on RallySafe, so no overall standings are available." },
        { status: 404 }
      );
    }

    const [stages, rallyId] = await Promise.all([
      getStages(resultsEventId),
      getMainRallyId(resultsEventId),
    ]);
    if (!rallyId) {
      return NextResponse.json({ error: "Could not resolve this event's rally group." }, { status: 404 });
    }

    const latest = latestCompletedStage(stages);
    if (!latest) {
      return NextResponse.json(
        { error: "No stage has finished yet — overall standings appear once the first stage completes." },
        { status: 404 }
      );
    }

    const [entries, results] = await Promise.all([
      getEntries(resultsEventId, rallyId),
      getStageResults(resultsEventId, latest.stageId, rallyId),
    ]);

    const resultByEntryId = new Map(results.map((r) => [r.entryId, r]));

    const rows: OverallStanding[] = [];
    for (const entry of entries) {
      const result = resultByEntryId.get(entry.entryId);
      // No timed result yet for this entry (DNS, withdrawn before this stage, etc) — skip.
      if (!result) continue;

      rows.push({
        position: result.position,
        number: Number(entry.identifier) || 0,
        carClass: entry.eventClasses?.[0]?.name ?? "",
        carModel: entry.manufacturer?.name
          ? `${entry.manufacturer.name} ${entry.vehicleModel ?? ""}`.trim()
          : entry.vehicleModel ?? "",
        driverName: entry.driver?.fullName ?? "Unknown",
        codriverName: entry.codriver?.fullName ?? "Unknown",
        stagesCompleted: latest.number,
        totalMs: result.totalTimeMs,
        gapToLeaderMs: result.diffFirstMs,
        gapToAheadMs: result.diffPrevMs,
        isRetired: entry.status === "Retired" || entry.status === "Out",
        isPenalized: result.penaltyTimeMs > 0,
        penaltySecondsNet: Math.round(result.penaltyTimeMs / 1000),
      });
    }

    // Running cars first (by position, which already reflects retired/etc handling from
    // the official source), retired cars pushed after even if their raw position was earlier.
    rows.sort((a, b) => {
      if (a.isRetired !== b.isRetired) return a.isRetired ? 1 : -1;
      return a.position - b.position;
    });
    rows.forEach((r, i) => {
      r.position = i + 1;
    });

    return NextResponse.json({
      stages: stages
        .filter((s) => s.stageType === "SpecialStage")
        .map((s) => ({ name: s.name, status: s.status, length: s.distance })),
      standings: rows,
      serviceIn: [], // official feed doesn't expose service predictions — ARA combiner does
      timeZone: "",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch overall standings from the official results API." }, { status: 502 });
  }
}

// Universal overall-standings computation using RallySafe's real-time race-control feed
// (rc.statusas.com — same cookie-authenticated client already used in lib/rallysafe.ts),
// NOT the separate results-api.statusas.com system. This matters because results-api
// requires the event organizer to have explicitly made their results page public, and
// many events (including most non-ARA rallies) never do — that endpoint 401s for them.
//
// rc.statusas.com's /times/stage-times endpoint has no such gate: it's the same public,
// anonymous-cookie-based feed already used everywhere else in this app for live tracking,
// and it works for literally any event with completed stages, ARA or not. We fetch every
// completed stage's times, sum them per driver, and produce the same OverallStanding shape
// as lib/combiner.ts so the Results page can render both through one identical table.
import { rsFetch } from "./rallysafe";

export interface RSStageTimeEntry {
  stageTimeId: number;
  locationGroupId: number;
  classId: number;
  driver: { firstName: string; surname: string; countryCode: string };
  navigator: { firstName: string; surname: string; countryCode: string } | null;
  identifier: string; // car number (or a special label like "Sweep Sweep" for course cars)
  status: number;
  make: string;
  stageTime: number; // milliseconds
  penaltyTime: number; // milliseconds
  jumpStart: boolean;
  lateStart: boolean;
}

interface RSStageMeta {
  locationGroupId: number;
  number: number;
  name: string;
  status: number; // 4 = completed (empirically observed)
  isTransit: boolean;
}

async function getStageTimes(stageId: number): Promise<RSStageTimeEntry[]> {
  return rsFetch<RSStageTimeEntry[]>(`/times/stage-times?stageId=${stageId}`);
}

export interface OverallStanding {
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

/** A car number ("25") or a course/sweep vehicle placeholder ("Sweep Sweep") — only
 * numeric identifiers represent real competitive entries we want in the standings. */
function isCompetitiveIdentifier(identifier: string): boolean {
  return /^\d+$/.test(identifier.trim());
}

/**
 * Computes real overall standings for ANY event (ARA or not) from RallySafe's live-tracking
 * feed, by summing every completed stage's time + penalty per driver. Requires the stage
 * list (to know which locationGroupIds are completed, non-transit special stages) and then
 * fetches each one's times.
 */
export async function computeRcOverallStandings(
  stages: RSStageMeta[],
  entriesByIdentifier: Map<string, { carClass: string; carModel: string }>
): Promise<{ standings: OverallStanding[]; stagesCompleted: number }> {
  const completedStages = stages
    .filter((s) => s.status === 4 && !s.isTransit)
    .sort((a, b) => a.number - b.number);

  if (completedStages.length === 0) {
    return { standings: [], stagesCompleted: 0 };
  }

  const perDriver = new Map<
    string,
    {
      number: number;
      driverName: string;
      codriverName: string;
      totalMs: number;
      penaltyMsTotal: number;
      stagesCompleted: number;
      lastSeenStageOrder: number;
    }
  >();

  for (const stage of completedStages) {
    const times = await getStageTimes(stage.locationGroupId);
    for (const t of times) {
      if (!isCompetitiveIdentifier(t.identifier)) continue;
      const key = t.identifier;
      const driverName = `${t.driver.firstName} ${t.driver.surname}`.trim();
      const codriverName = t.navigator ? `${t.navigator.firstName} ${t.navigator.surname}`.trim() : "";
      const existing = perDriver.get(key);
      const stageMs = t.stageTime ?? 0;
      const penMs = t.penaltyTime ?? 0;
      if (existing) {
        existing.totalMs += stageMs + penMs;
        existing.penaltyMsTotal += penMs;
        existing.stagesCompleted += stageMs > 0 ? 1 : 0;
        existing.lastSeenStageOrder = stage.number;
      } else {
        perDriver.set(key, {
          number: Number(t.identifier) || 0,
          driverName,
          codriverName,
          totalMs: stageMs + penMs,
          penaltyMsTotal: penMs,
          stagesCompleted: stageMs > 0 ? 1 : 0,
          lastSeenStageOrder: stage.number,
        });
      }
    }
  }

  const latestStageNumber = completedStages[completedStages.length - 1].number;
  const rows: OverallStanding[] = [];
  for (const [identifier, d] of perDriver) {
    const meta = entriesByIdentifier.get(identifier);
    // A car that stopped appearing before the latest completed stage is treated as retired —
    // this feed has no explicit "Retired" flag like results-api does, so we infer it from
    // whether it was still being timed on the most recent stage.
    const isRetired = d.lastSeenStageOrder < latestStageNumber;
    rows.push({
      position: 0,
      number: d.number,
      carClass: meta?.carClass ?? "",
      carModel: meta?.carModel ?? "",
      driverName: d.driverName,
      codriverName: d.codriverName,
      stagesCompleted: d.stagesCompleted,
      totalMs: d.totalMs,
      gapToLeaderMs: 0,
      gapToAheadMs: 0,
      isRetired,
      isPenalized: d.penaltyMsTotal > 0,
      penaltySecondsNet: Math.round(d.penaltyMsTotal / 1000),
    });
  }

  rows.sort((a, b) => {
    if (a.isRetired !== b.isRetired) return a.isRetired ? 1 : -1;
    return a.totalMs - b.totalMs;
  });

  const leaderMs = rows.find((r) => !r.isRetired)?.totalMs ?? rows[0]?.totalMs ?? 0;
  let prevMs = leaderMs;
  rows.forEach((r, i) => {
    r.position = i + 1;
    r.gapToLeaderMs = r.totalMs - leaderMs;
    r.gapToAheadMs = i === 0 ? 0 : r.totalMs - prevMs;
    prevMs = r.totalMs;
  });

  return { standings: rows, stagesCompleted: latestStageNumber };
}

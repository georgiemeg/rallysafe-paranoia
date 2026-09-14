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
import { rankByFieldDistance } from "./overall-rank";
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
export type { RSStageMeta };

async function getStageTimes(stageId: number): Promise<RSStageTimeEntry[]> {
  return rsFetch<RSStageTimeEntry[]>(`/times/stage-times?stageId=${stageId}`);
}

export interface RcCarStageTime {
  stageNumber: number;
  name: string;
  timeMs: number | null;
  penaltyMs: number;
}

/** Real per-car stage-by-stage times from RallySafe's raw feed, for the click-to-expand
 * panel on the live/fallback Results path (mirrors the eWRC version used on finished
 * events, so both paths support the same interaction). */
export async function getRcCarStages(
  stages: RSStageMeta[],
  carNumber: string
): Promise<{ carNumber: number; driverName: string; stages: RcCarStageTime[] } | null> {
  // Itinerary order, not stage.number — qualifying is often numbered 121 etc.
  const completedStages = stages.filter((s) => s.status === 4 && !s.isTransit);
  if (completedStages.length === 0) return null;

  const stageResults = await Promise.all(completedStages.map((stage) => getStageTimes(stage.locationGroupId)));
  let driverName = "";
  const out: RcCarStageTime[] = [];
  for (let si = 0; si < completedStages.length; si++) {
    const stage = completedStages[si];
    const row = stageResults[si].find((t) => t.identifier === carNumber);
    if (row && !driverName) driverName = `${row.driver.firstName} ${row.driver.surname}`.trim();
    out.push({
      stageNumber: stage.number,
      name: stage.name,
      timeMs: row?.stageTime && row.stageTime > 0 ? row.stageTime : null,
      penaltyMs: row?.penaltyTime ?? 0,
    });
  }
  if (!driverName) return null;
  return { carNumber: Number(carNumber) || 0, driverName, stages: out };
}

export interface OverallStanding {
  position: number;
  number: number;
  carClass: string;
  carModel: string;
  driverName: string;
  codriverName: string;
  stagesCompleted: number;
  stagesTotal?: number;
  totalMs: number;
  gapToLeaderMs: number;
  gapToAheadMs: number;
  isRetired: boolean;
  isPenalized: boolean;
  penaltySecondsNet: number;
  /** True when this car is missing a real stage time for at least one stage that OTHER
   * cars in the field completed — meaning their total is provisional/incomplete, not a
   * confirmed final number. Distinct from isRetired (which means they actually stopped). */
  hasIncompleteData?: boolean;
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
  // Keep itinerary order. Do NOT sort by stage.number — RallySafe often numbers
  // qualifying as 121 (etc.), which made the header read "121 / 4 stages" and
  // ranked/retired cars against the wrong "latest" stage.
  const completedStages = stages.filter((s) => s.status === 4 && !s.isTransit);

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
      lastSeenIndex: number;
      stagesWithTime: Set<number>;
    }
  >();

  const stageResults = await Promise.all(completedStages.map((stage) => getStageTimes(stage.locationGroupId)));

  for (let si = 0; si < completedStages.length; si++) {
    const stage = completedStages[si];
    const times = stageResults[si];
    for (const t of times) {
      if (!isCompetitiveIdentifier(t.identifier)) continue;
      const hasTime = t.stageTime != null && t.stageTime > 0;
      const key = t.identifier;
      const driverName = `${t.driver.firstName} ${t.driver.surname}`.trim();
      const codriverName = t.navigator ? `${t.navigator.firstName} ${t.navigator.surname}`.trim() : "";
      const existing = perDriver.get(key);
      const stageMs = hasTime ? t.stageTime! : 0;
      const penMs = t.penaltyTime ?? 0;
      if (existing) {
        if (hasTime) {
          existing.totalMs += stageMs + penMs;
          existing.penaltyMsTotal += penMs;
          existing.stagesCompleted += 1;
          existing.lastSeenIndex = si;
          existing.stagesWithTime.add(stage.number);
        }
      } else if (hasTime) {
        perDriver.set(key, {
          number: Number(t.identifier) || 0,
          driverName,
          codriverName,
          totalMs: stageMs + penMs,
          penaltyMsTotal: penMs,
          stagesCompleted: 1,
          lastSeenIndex: si,
          stagesWithTime: new Set([stage.number]),
        });
      }
    }
  }

  const lastCompletedIndex = completedStages.length - 1;
  const rows: OverallStanding[] = [];
  for (const [identifier, d] of perDriver) {
    const meta = entriesByIdentifier.get(identifier);
    // Retired = no time on the last completed itinerary stage (order, not number).
    const isRetired = d.lastSeenIndex < lastCompletedIndex;
    const stagesUpToLastSeen = completedStages.slice(0, d.lastSeenIndex + 1);
    const hasIncompleteData = !isRetired && stagesUpToLastSeen.some((s) => !d.stagesWithTime.has(s.number));
    rows.push({
      position: 0,
      number: d.number,
      carClass: meta?.carClass ?? "",
      carModel: meta?.carModel ?? "",
      driverName: d.driverName,
      codriverName: d.codriverName,
      hasIncompleteData,
      stagesCompleted: d.stagesCompleted,
      stagesTotal: stages.filter((s) => !s.isTransit).length,
      totalMs: d.totalMs,
      gapToLeaderMs: 0,
      gapToAheadMs: 0,
      isRetired,
      isPenalized: d.penaltyMsTotal > 0,
      penaltySecondsNet: Math.round(d.penaltyMsTotal / 1000),
    });
  }

  return { standings: rankByFieldDistance(rows), stagesCompleted: completedStages.length };
}

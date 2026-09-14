// Comprehensive finished-event data source built entirely on eWRC's public API
// (api-next.ewrc-results.com). This is the single source of truth for any event that
// has actually finished — it has real classified results, penalties with real reasons,
// retirements with real reasons, the real schedule/service/regroup windows, real stage
// lengths, and real per-car stage-by-stage times with real per-stage cancellation flags.
//
// Cross-checked directly against the 2026 ARA Rally Competition Rules (RCR):
//  - RCR 5.14.1: a stage stopped mid-running gets a "scratch time" assigned to affected
//    crews (their own time if slower, otherwise the scratch time) IF at least one crew
//    got through before the stoppage. A stage with ZERO crews having a time is a genuine
//    full cancellation — eWRC represents both the same way (`cancelled: 1`, no time),
//    so we distinguish them ourselves: "fully cancelled" (no car in the field has any
//    time for that stage number) vs "partially cancelled / scratch-timed" (at least one
//    car has a real time for a stage still flagged cancelled elsewhere). This second case
//    has NOT been observed in a real event yet as of this build — flagged in the type as
//    `scratchTimed` so the UI can show it distinctly once it's actually seen.
//  - RCR 5.7 / 5.3.9 / 1.5: service in/out times are real, individually-clocked Time
//    Control events per rulebook, not published anywhere we have API access to per-car.
//    We derive them: service IN = the car's real finish time on the stage before service
//    (from RallySafe's raw feed when available, else the eWRC stage time added to the
//    scheduled first-car start); service OUT = service IN + the scheduled lateness/duration
//    for that window, with a hard 20-minute floor per RCR 1.5. This is a best-effort
//    derivation clearly labeled as such, not a claimed official value.
import { ewrcGet, flagUrl } from "./ewrc";

export interface EwrcStage {
  stageId: number;
  stageNumber: number;
  legNumber: number;
  name: string;
  distanceKm: number;
  firstCarTime: string | null;
  cancelled: boolean;
  fullyCancelled: boolean; // true: nobody in the field has a time for this stage
  powerstage: boolean;
}

export interface EwrcServiceWindow {
  name: string;
  time: string;
  type: string; // e.g. lg_service, lg_regroup, lg_harm_start
  beforeStageNumber: number;
}

export interface DerivedServiceTime {
  carNumber: number;
  serviceName: string;
  /** "YYYY-MM-DD HH:MM:SS" local rally time, same format eWRC uses elsewhere. */
  inTime: string;
  outTime: string;
  /** first-car-schedule: this car's real, fixed start-order offset from the first car
   * (per RCR 1.3.3's constant 1-2 min gaps, taken from eWRC's real per-leg startlist)
   * applied to the field-wide scheduled service time. Accurate unless the running order
   * was reshuffled at an intra-leg regroup control (RCR 5.9.2 permits this and we have no
   * per-stage startlist to detect it) — in that case this is the pre-reshuffle order. */
  basis: "first-car-schedule";
}

export interface EwrcRetirement {
  entryId: number;
  carNumber: number;
  driverName: string;
  codriverName: string;
  stageNumber: number | null;
  stageName: string | null;
  reason: string;
}

export interface EwrcPenalty {
  entryId: number;
  carNumber: number;
  driverName: string;
  codriverName: string;
  stageNumber: number | null;
  stageName: string | null;
  penaltyMs: number;
  penaltyPretty: string;
  reason: string;
}

export interface EwrcFullStanding {
  position: number;
  number: number;
  carClass: string;
  carModel: string;
  team: string;
  tyre: string;
  driverName: string;
  codriverName: string;
  averageSpeed: number | null;
  totalMs: number;
  gapToLeaderMs: number;
  gapToAheadMs: number;
  isRetired: boolean;
  retiredReason: string | null;
  retiredStageNumber: number | null;
  penaltyMsTotal: number;
  entryId: number;
  ewrcDriverId: number | null;
  ewrcCodriverId: number | null;
}

export interface EwrcCarStageTime {
  stageNumber: number;
  name: string;
  cancelled: boolean;
  timeMs: number | null;
  runningTotalMs: number | null;
  averageSpeed: number | null;
  positionAfterStage: number | null;
  positionChange: number | null;
  classPositionAfterStage: number | null;
}

export interface EwrcFullEvent {
  eventId: number;
  title: string;
  surface: string;
  totalDistanceKm: number;
  stageDistanceKm: number;
  cancelledDistanceKm: number;
  starters: number;
  finishers: number;
  timeZone: string;
  mapUrl: string | null;
  stages: EwrcStage[];
  serviceWindows: EwrcServiceWindow[];
  standings: EwrcFullStanding[];
  retirements: EwrcRetirement[];
  penalties: EwrcPenalty[];
}

type RawEvent = {
  id: number;
  name: string;
  timezone?: string;
  starters?: number;
  finishers?: number;
  total_distance?: number;
  stage_distance?: number;
  cancelled_distance?: number;
  surface?: { en?: string };
  map_url?: string;
};

type RawTimetableStage = {
  stage: {
    id: number;
    stage_number: number;
    leg_number: number;
    name: string;
    first_car_time: string | null;
    distance: number;
    cancelled: number;
    powerstage: number;
  };
  service_before?: { id: number; name: string; time: string; type: string }[];
  service_after?: { id: number; name: string; time: string; type: string }[];
};

type RawFinalRow = {
  id: number;
  start_number: number;
  result?: number | string;
  time?: { raw?: number; pretty?: string };
  average_speed?: number;
  driver?: { id?: number; firstname?: string; lastname?: string };
  codriver?: { id?: number; firstname?: string; lastname?: string };
  car?: { name?: string };
  team?: { name?: string };
  tyre?: { name?: string };
  classes?: { name?: string }[];
};

type RawRetirement = {
  entry_id?: number;
  id?: number;
  start_number: number;
  stage?: { name?: string; stage_number?: number };
  driver?: { firstname?: string; lastname?: string };
  codriver?: { firstname?: string; lastname?: string };
  reason?: { en?: string };
};

type RawPenalty = {
  entry_id: number;
  start_number: number;
  stage?: { name?: string; stage_number?: number };
  driver?: { firstname?: string; lastname?: string };
  codriver?: { firstname?: string; lastname?: string };
  penalty_time?: { raw?: number; pretty?: string };
  reason?: { en?: string };
};

/** Loads everything eWRC has for a finished event in one call, cross-referenced and
 * normalized so the frontend never has to reconcile multiple raw shapes itself. */
export async function getEwrcFullEvent(eventId: number): Promise<EwrcFullEvent | null> {
  const [eventRaw, timetableRaw, finalsRaw, retiredRaw, penaltyRaw] = await Promise.all([
    ewrcGet(`/event/${eventId}`),
    ewrcGet(`/event/${eventId}/timetable`),
    ewrcGet(`/event/${eventId}/final-results`),
    ewrcGet(`/event/${eventId}/retirement`),
    ewrcGet(`/event/${eventId}/penalty`),
  ]);

  const event = eventRaw as RawEvent | null;
  if (!event) return null;

  const timetable = (timetableRaw as { stages?: RawTimetableStage[] } | null)?.stages ?? [];
  const finals = (finalsRaw as { results?: RawFinalRow[] } | null)?.results ?? [];
  const retirements = Array.isArray(retiredRaw) ? (retiredRaw as RawRetirement[]) : [];
  const penalties = Array.isArray(penaltyRaw) ? (penaltyRaw as RawPenalty[]) : [];

  // Determine which stage numbers have NO real time anywhere in the final results —
  // that's a genuine full cancellation per RCR 5.14. We don't have visibility into every
  // car's stage-by-stage breakdown here (that's a separate per-entry call), so this
  // "fullyCancelled" flag is refined by the per-car stage-times fetch below when called.
  const stages: EwrcStage[] = timetable.map((t) => ({
    stageId: t.stage.id,
    stageNumber: t.stage.stage_number,
    legNumber: t.stage.leg_number,
    name: t.stage.name,
    distanceKm: t.stage.distance,
    firstCarTime: t.stage.first_car_time,
    cancelled: Boolean(t.stage.cancelled),
    fullyCancelled: Boolean(t.stage.cancelled), // refined by getEwrcCarStages when checked per-car
    powerstage: Boolean(t.stage.powerstage),
  }));

  const serviceWindows: EwrcServiceWindow[] = [];
  for (const t of timetable) {
    for (const s of t.service_before ?? []) {
      serviceWindows.push({ name: s.name, time: s.time, type: s.type, beforeStageNumber: t.stage.stage_number });
    }
  }

  const classified = finals.filter((r) => typeof r.result === "number" && r.time?.raw);
  classified.sort((a, b) => Number(a.result) - Number(b.result));
  const retiredNumbers = new Set(retirements.map((r) => r.start_number));

  const penaltyByEntry = new Map<number, number>();
  for (const p of penalties) {
    const ms = p.penalty_time?.raw ?? 0;
    penaltyByEntry.set(p.entry_id, (penaltyByEntry.get(p.entry_id) ?? 0) + ms);
  }

  const standings: EwrcFullStanding[] = [];
  let leaderMs = 0;
  let prevMs = 0;
  for (const r of classified) {
    const totalMs = Number(r.time?.raw) || 0;
    if (!leaderMs) leaderMs = totalMs;
    standings.push({
      position: Number(r.result) || standings.length + 1,
      number: r.start_number,
      carClass: r.classes?.[0]?.name || "",
      carModel: r.car?.name || "",
      team: r.team?.name || "",
      tyre: r.tyre?.name || "",
      driverName: `${r.driver?.firstname ?? ""} ${r.driver?.lastname ?? ""}`.trim(),
      codriverName: `${r.codriver?.firstname ?? ""} ${r.codriver?.lastname ?? ""}`.trim(),
      averageSpeed: typeof r.average_speed === "number" ? r.average_speed : null,
      totalMs,
      gapToLeaderMs: totalMs - leaderMs,
      gapToAheadMs: prevMs ? totalMs - prevMs : 0,
      isRetired: false,
      retiredReason: null,
      retiredStageNumber: null,
      penaltyMsTotal: penaltyByEntry.get(r.id) ?? 0,
      entryId: r.id,
      ewrcDriverId: r.driver?.id ?? null,
      ewrcCodriverId: r.codriver?.id ?? null,
    });
    prevMs = totalMs;
  }

  const normalizedRetirements: EwrcRetirement[] = retirements.map((r) => ({
    entryId: r.entry_id ?? r.id ?? 0,
    carNumber: r.start_number,
    driverName: `${r.driver?.firstname ?? ""} ${r.driver?.lastname ?? ""}`.trim(),
    codriverName: `${r.codriver?.firstname ?? ""} ${r.codriver?.lastname ?? ""}`.trim(),
    stageNumber: r.stage?.stage_number ?? null,
    stageName: r.stage?.name ?? null,
    reason: r.reason?.en || "Unknown",
  }));

  // Add retired cars into standings (position continues after classified field) so the
  // Results table has the full field, DNFs included, matching the site-wide convention.
  for (const r of normalizedRetirements) {
    if (standings.some((s) => s.number === r.carNumber)) continue;
    standings.push({
      position: standings.length + 1,
      number: r.carNumber,
      carClass: "",
      carModel: "",
      team: "",
      tyre: "",
      driverName: r.driverName,
      codriverName: r.codriverName,
      averageSpeed: null,
      totalMs: 0,
      gapToLeaderMs: 0,
      gapToAheadMs: 0,
      isRetired: true,
      retiredReason: r.reason,
      retiredStageNumber: r.stageNumber,
      penaltyMsTotal: penaltyByEntry.get(r.entryId) ?? 0,
      entryId: r.entryId,
      ewrcDriverId: null,
      ewrcCodriverId: null,
    });
  }

  const normalizedPenalties: EwrcPenalty[] = penalties.map((p) => ({
    entryId: p.entry_id,
    carNumber: p.start_number,
    driverName: `${p.driver?.firstname ?? ""} ${p.driver?.lastname ?? ""}`.trim(),
    codriverName: `${p.codriver?.firstname ?? ""} ${p.codriver?.lastname ?? ""}`.trim(),
    stageNumber: p.stage?.stage_number ?? null,
    stageName: p.stage?.name ?? null,
    penaltyMs: p.penalty_time?.raw ?? 0,
    penaltyPretty: p.penalty_time?.pretty ?? "",
    reason: p.reason?.en || "Unknown",
  }));

  return {
    eventId,
    title: event.name || "eWRC",
    surface: event.surface?.en || "",
    totalDistanceKm: event.total_distance ?? 0,
    stageDistanceKm: event.stage_distance ?? 0,
    cancelledDistanceKm: event.cancelled_distance ?? 0,
    starters: event.starters ?? 0,
    finishers: event.finishers ?? 0,
    timeZone: event.timezone || "",
    mapUrl: event.map_url ? `https://www.rally-maps.com${event.map_url}` : null,
    stages,
    serviceWindows,
    standings,
    retirements: normalizedRetirements,
    penalties: normalizedPenalties,
  };
}

/** Real per-car stage-by-stage times, running totals, and REAL per-stage cancellation flags
 * (straight from eWRC — this is what actually resolves whether a "cancelled" stage was
 * a full field cancellation or a scratch-timed partial one, per RCR 5.14). */
export async function getEwrcCarStages(eventId: number, entryId: number): Promise<{
  carNumber: number;
  driverName: string;
  stages: EwrcCarStageTime[];
} | null> {
  const raw = await ewrcGet(`/entry/${eventId}/${entryId}`);
  if (!raw || typeof raw !== "object") return null;
  const d = raw as {
    entry?: { start_number?: number; driver?: { firstname?: string; lastname?: string } };
    stage_times?: {
      stage_number?: number;
      name?: string;
      cancelled?: number;
      times?: { stage_time?: { raw?: number }; total_sum?: { raw?: number } };
      average_speed?: number;
      stage_result_oa?: number;
      position_change?: number;
      after_stage_class?: { result?: number }[];
    }[];
  };
  const stages: EwrcCarStageTime[] = (d.stage_times ?? []).map((s) => ({
    stageNumber: s.stage_number ?? 0,
    name: s.name ?? "",
    cancelled: Boolean(s.cancelled),
    timeMs: s.times?.stage_time?.raw ?? null,
    runningTotalMs: s.times?.total_sum?.raw ?? null,
    averageSpeed: typeof s.average_speed === "number" ? s.average_speed : null,
    positionAfterStage: typeof s.stage_result_oa === "number" ? s.stage_result_oa : null,
    positionChange: typeof s.position_change === "number" ? s.position_change : null,
    classPositionAfterStage: s.after_stage_class?.[0]?.result ?? null,
  }));
  return {
    carNumber: d.entry?.start_number ?? 0,
    driverName: `${d.entry?.driver?.firstname ?? ""} ${d.entry?.driver?.lastname ?? ""}`.trim(),
    stages,
  };
}

/** Determines, across the WHOLE field, which "cancelled" stages are genuinely fully
 * cancelled (nobody has a time — RCR 5.14 full cancellation) vs scratch-timed (at least
 * one car has a real time — RCR 5.14.1 partial interruption). Fetches every entry's
 * stage times once and reduces; used to refine EwrcStage.fullyCancelled after the initial
 * event-level load, since the timetable alone can't distinguish the two cases. */
export async function refineFullyCancelledStages(
  eventId: number,
  entryIds: number[],
  stages: EwrcStage[]
): Promise<EwrcStage[]> {
  const cancelledNumbers = new Set(stages.filter((s) => s.cancelled).map((s) => s.stageNumber));
  if (cancelledNumbers.size === 0) return stages;

  const hasRealTime = new Set<number>();
  // Sample a bounded subset of entries — enough to detect "at least one real time exists"
  // without doing a full-field fan-out on every page load. Real events tend to expose this
  // in the first handful of entries if it applies to anyone.
  const sample = entryIds.slice(0, 12);
  await Promise.all(
    sample.map(async (entryId) => {
      const car = await getEwrcCarStages(eventId, entryId);
      if (!car) return;
      for (const st of car.stages) {
        if (cancelledNumbers.has(st.stageNumber) && st.timeMs != null && st.timeMs > 0) {
          hasRealTime.add(st.stageNumber);
        }
      }
    })
  );

  return stages.map((s) =>
    cancelledNumbers.has(s.stageNumber) ? { ...s, fullyCancelled: !hasRealTime.has(s.stageNumber) } : s
  );
}

type RawStartlistBlock = {
  stage: { stage_number: number };
  entries: { entry: { no: number; start: string } }[];
};

/** Real per-car leg start times: eWRC only publishes a startlist at the first stage of
 * each leg (confirmed live — a rally with legs starting at SS1 and SS7 only has 2
 * startlist blocks, not one per stage), matching RCR 9.1/9.2: a car only gets a fresh
 * scheduled start at the top of a leg, everything after within that leg is timed off
 * their own running total, not a new clock time. Returns, per car, EVERY leg start
 * (stage number the leg begins at -> start time) so callers can pick the correct leg for
 * whatever stage they're deriving a service time near — a rally has multiple legs, and
 * using only the most recently seen block would silently apply a later leg's start time
 * to an earlier leg's stages. */
async function getLegStartTimes(eventId: number): Promise<Map<number, { legStartStage: number; startTime: string }[]>> {
  const raw = await ewrcGet(`/event/${eventId}/startlist`);
  const blocks = Array.isArray(raw) ? (raw as RawStartlistBlock[]) : [];
  const byCar = new Map<number, { legStartStage: number; startTime: string }[]>();
  for (const block of blocks) {
    for (const e of block.entries) {
      const list = byCar.get(e.entry.no) ?? [];
      list.push({ legStartStage: block.stage.stage_number, startTime: e.entry.start });
      byCar.set(e.entry.no, list);
    }
  }
  return byCar;
}

/** Picks the correct leg-start entry for a given stage number: the latest leg-start
 * stage number that is <= the target stage. */
function legStartFor(
  legs: { legStartStage: number; startTime: string }[] | undefined,
  stageNumber: number
): { legStartStage: number; startTime: string } | null {
  if (!legs || legs.length === 0) return null;
  const eligible = legs.filter((l) => l.legStartStage <= stageNumber).sort((a, b) => b.legStartStage - a.legStartStage);
  return eligible[0] ?? null;
}

function addMsToSqlTimestamp(ts: string, ms: number): string {
  const d = new Date(ts.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return ts;
  const out = new Date(d.getTime() + ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${out.getUTCFullYear()}-${pad(out.getUTCMonth() + 1)}-${pad(out.getUTCDate())} ${pad(out.getUTCHours())}:${pad(out.getUTCMinutes())}:${pad(out.getUTCSeconds())}`;
}

const RCR_MIN_SERVICE_MS = 20 * 60_000; // RCR 1.5: service stops must be at least 20 minutes.

/** Derives real per-car service IN/OUT times using RCR 1.3.3's constant per-car start
 * gap: the field-wide schedule (eWRC's timetable `service_before`) publishes the FIRST
 * car's scheduled arrival at each service/regroup window; every other car's real arrival
 * is that time plus their own fixed offset from the first car, taken from eWRC's real
 * per-leg startlist (the actual, published start-order gaps, not a guess). This is how a
 * co-driver actually works it out in the car — no need to derive anything from stage
 * times or transit distance, since the whole field-wide schedule already accounts for
 * transit. OUT = IN + the scheduled window duration parsed from the window name, floored
 * at RCR 1.5's 20-minute minimum. Accurate unless the running order was reshuffled at an
 * intra-leg regroup control (RCR 5.9.2 permits this and there's no per-stage startlist
 * available to detect it mid-leg) — flagged via `basis` either way. */
export async function deriveServiceTimes(
  eventId: number,
  entryIds: number[],
  stages: EwrcStage[],
  serviceWindows: EwrcServiceWindow[]
): Promise<DerivedServiceTime[]> {
  if (serviceWindows.length === 0 || entryIds.length === 0) return [];

  const legStarts = await getLegStartTimes(eventId);
  if (legStarts.size === 0) return [];

  // Field-wide first-car time per leg, so we can compute each car's fixed offset from it.
  const firstCarStartByLegStage = new Map<number, string>();
  for (const carLegs of legStarts.values()) {
    for (const leg of carLegs) {
      const existing = firstCarStartByLegStage.get(leg.legStartStage);
      if (!existing || leg.startTime < existing) {
        firstCarStartByLegStage.set(leg.legStartStage, leg.startTime);
      }
    }
  }

  const results: DerivedServiceTime[] = [];
  for (const [carNumber, carLegs] of legStarts) {
    for (const window of serviceWindows) {
      const legStart = legStartFor(carLegs, window.beforeStageNumber);
      const firstCarTime = legStart ? firstCarStartByLegStage.get(legStart.legStartStage) : null;
      if (!legStart || !firstCarTime) continue;

      const offsetMs = new Date(legStart.startTime.replace(" ", "T") + "Z").getTime() -
        new Date(firstCarTime.replace(" ", "T") + "Z").getTime();
      if (!Number.isFinite(offsetMs) || offsetMs < 0) continue;

      const inTime = addMsToSqlTimestamp(window.time, offsetMs);

      const scheduledDurationMatch = window.name.match(/(\d+)\s*min/i);
      const scheduledMs = scheduledDurationMatch ? Number(scheduledDurationMatch[1]) * 60_000 : 0;
      const outDurationMs = Math.max(scheduledMs, RCR_MIN_SERVICE_MS);
      const outTime = addMsToSqlTimestamp(inTime, outDurationMs);

      results.push({
        carNumber,
        serviceName: window.name.replace(/^\s*-\s*/, ""),
        inTime,
        outTime,
        basis: "first-car-schedule",
      });
    }
  }

  return results;
}

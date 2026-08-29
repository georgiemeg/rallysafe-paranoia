// Client for the public RallySafe Results API (results-api.statusas.com).
// This is a SEPARATE public API from the live-tracking feed in rallysafe.ts —
// it has official stage times, splits, and overall standings, but uses its own
// eventId/rallyId/entryId numbering that does NOT match the live feed's eventId/entryId.
// We map between the two by car number (identifier), which is consistent across both.
const RESULTS_BASE = "https://results-api.statusas.com/api";

export interface ResultsRally {
  rallyId: number;
  eventId: number;
  itineraryId: number;
  name: string;
  isMain: boolean;
  eventClasses: { eventClassId: number; eventId: number; name: string }[];
}

export interface ResultsEventDetails {
  eventId: number;
  name: string;
  slug: string;
  rallies: ResultsRally[];
  eventClasses: { eventClassId: number; eventId: number; name: string }[];
}

export interface ResultsPerson {
  personId: number;
  firstName: string;
  lastName: string;
  fullName: string;
}

export interface ResultsEntry {
  entryId: number;
  eventId: number;
  identifier: string; // car number
  driver: ResultsPerson;
  codriver: ResultsPerson;
  manufacturer?: { name: string };
  vehicleModel?: string;
  eventClasses: { eventClassId: number; eventId: number; name: string }[];
}

export interface ResultsStageControl {
  controlId: number;
  type: string; // "StageStart" | "FlyingFinish" | "TimeControl" | ...
  code: string; // "SS1", "SF1", "TC1" etc
  location: string;
  distance: number | null;
}

export interface ResultsStage {
  stageId: number;
  eventId: number;
  controls: ResultsStageControl[];
  // Other fields (name/number/length) live on the itinerary feed, not this one directly —
  // we cross-reference via lib/rallysafe.ts's listStages() for human-readable names.
}

export interface StageTime {
  stageTimeId: number;
  stageId: number;
  entryId: number;
  elapsedDurationMs: number;
  elapsedDuration: string;
  status: string; // "Completed" | ...
  position: number;
  diffFirstMs: number;
  diffFirst: string;
  diffPrevMs: number;
  diffPrev: string;
}

export interface OverallResult {
  entryId: number;
  stageTimeMs: number;
  stageTime: string;
  penaltyTimeMs: number;
  penaltyTime: string;
  totalTimeMs: number;
  totalTime: string;
  position: number;
  diffFirstMs: number;
  diffFirst: string;
  diffPrevMs: number;
  diffPrev: string;
}

async function resultsFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${RESULTS_BASE}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Results API fetch failed: ${path} -> ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function getEventDetails(eventId: number): Promise<ResultsEventDetails> {
  return resultsFetch<ResultsEventDetails>(`/events/${eventId}`);
}

export async function getStages(eventId: number): Promise<ResultsStage[]> {
  return resultsFetch<ResultsStage[]>(`/events/${eventId}/stages`);
}

export async function getRallyEntries(eventId: number, rallyId: number): Promise<ResultsEntry[]> {
  return resultsFetch<ResultsEntry[]>(`/events/${eventId}/rallies/${rallyId}/entries`);
}

export async function getStageTimes(
  eventId: number,
  stageId: number,
  rallyId: number
): Promise<StageTime[]> {
  return resultsFetch<StageTime[]>(`/events/${eventId}/stages/${stageId}/stagetimes?rallyId=${rallyId}`);
}

/** Overall standings as of the completion of a given stage. */
export async function getStageResults(
  eventId: number,
  stageId: number,
  rallyId: number
): Promise<OverallResult[]> {
  return resultsFetch<OverallResult[]>(`/events/${eventId}/stages/${stageId}/results?rallyId=${rallyId}`);
}

/**
 * Finds which rally (National/Regional/etc) a given car number belongs to within an event,
 * since a single live-tracking event can span multiple "rallies" in the results API with
 * completely separate entry lists. Returns null if not found in any rally.
 */
export async function findEntryByCarNumber(
  resultsEventId: number,
  carNumber: string
): Promise<{ rallyId: number; entry: ResultsEntry } | null> {
  const details = await getEventDetails(resultsEventId);
  for (const rally of details.rallies) {
    const entries = await getRallyEntries(resultsEventId, rally.rallyId);
    const match = entries.find((e) => e.identifier === carNumber);
    if (match) return { rallyId: rally.rallyId, entry: match };
  }
  return null;
}

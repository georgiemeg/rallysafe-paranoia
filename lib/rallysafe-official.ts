// Client for RallySafe's OFFICIAL results API (results-api.statusas.com) — a completely
// separate system from both the live-tracking feed (rc.statusas.com) and the ARA-only
// "combiner" feed (sneakattackrally.com). This one is public, requires no auth/cookie,
// and — critically — works for ANY event that has a results page linked on RallySafe,
// not just ARA-sanctioned rallies. It's what powers the official results.statusas.com
// site (the "Stage / Split Times" iframe already embedded in this app).
//
// We use it here to build a real Overall (Live) standings table for non-ARA events,
// matching the same table UI already used for ARA events (which stays on the combiner
// feed, since only that feed has predicted service times for the Service Estimates
// alert type).
const BASE = "https://results-api.statusas.com/api";

export interface OfficialRally {
  rallyId: number;
  eventId: number;
  itineraryId: number;
  name: string;
  isMain: boolean;
}

export interface OfficialStage {
  stageId: number;
  eventId: number;
  number: number;
  name: string;
  distance: number;
  status: string; // "Completed" | "Running" | "ToRun" | "Cancelled"
  stageType: string;
  code: string;
}

export interface OfficialEntry {
  entryId: number;
  identifier: string; // car number
  vehicleModel: string;
  status: string; // "Entry" | "Out" | "Retired"
  driver: { fullName: string };
  codriver: { fullName: string };
  eventClasses: { name: string }[];
  manufacturer?: { name: string };
}

export interface OfficialStageResult {
  entryId: number;
  stageTimeMs: number;
  penaltyTimeMs: number;
  totalTimeMs: number;
  position: number;
  diffFirstMs: number;
  diffPrevMs: number;
}

async function officialFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Official results API fetch failed: ${path} -> ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function getEventProfile(resultsEventId: number) {
  return officialFetch<{ rallies: OfficialRally[] }>(`/events/${resultsEventId}`);
}

export async function getMainRallyId(resultsEventId: number): Promise<number | null> {
  const data = await getEventProfile(resultsEventId);
  const main = data.rallies?.find((r) => r.isMain) ?? data.rallies?.[0];
  return main?.rallyId ?? null;
}

export async function getStages(resultsEventId: number): Promise<OfficialStage[]> {
  return officialFetch<OfficialStage[]>(`/events/${resultsEventId}/stages`);
}

export async function getEntries(resultsEventId: number, rallyId: number): Promise<OfficialEntry[]> {
  return officialFetch<OfficialEntry[]>(`/events/${resultsEventId}/rallies/${rallyId}/entries`);
}

export async function getStageResults(
  resultsEventId: number,
  stageId: number,
  rallyId: number
): Promise<OfficialStageResult[]> {
  return officialFetch<OfficialStageResult[]>(
    `/events/${resultsEventId}/stages/${stageId}/results?rallyId=${rallyId}`
  );
}

/** Finds the latest stage that has actually completed (highest stage number with
 * status "Completed"), skipping cancelled/upcoming stages. Returns null if none yet. */
export function latestCompletedStage(stages: OfficialStage[]): OfficialStage | null {
  const completed = stages.filter((s) => s.status === "Completed" && s.stageType === "SpecialStage");
  if (completed.length === 0) return null;
  return completed.reduce((latest, s) => (s.number > latest.number ? s : latest), completed[0]);
}

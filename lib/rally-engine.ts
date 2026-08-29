// Core logic connecting live GPS state -> results API -> formatted alerts.
import {
  listStages as getLiveStages,
  getResultsEventId,
} from "@/lib/rallysafe";
import {
  getEventDetails,
  getRallyEntries,
  getStages as getResultsStages,
  getStageTimes,
  getStageResults,
  findEntryByCarNumber,
  type ResultsEntry,
  type StageTime,
  type OverallResult,
} from "@/lib/rallysafe-results";
import type { CarSubscription } from "@/lib/store";
import { stageTimesMessage, overallTimeMessage } from "@/lib/messages";

interface StageMapping {
  resultsEventId: number;
  rallyId: number;
  // Maps live-feed stage number (1-indexed, matches RSEvent.stageNumber) -> results-api stageId
  liveStageNumberToResultsStageId: Map<number, number>;
  liveStageNumberToName: Map<number, string>; // e.g. 4 -> "SS4 Steamboat 2"
}

const mappingCache = new Map<number, { mapping: StageMapping; cachedAt: number }>();
const MAPPING_TTL_MS = 30 * 60 * 1000;

/**
 * Builds (and caches) the mapping between the live-tracking event's stage numbers and the
 * Results API's stageId numbering, plus human names. Both APIs list stages in the same
 * running order, so we align by array position (both are ordered SS1, SS2, SS3...).
 */
export async function getStageMapping(liveEventId: number, rallyId: number): Promise<StageMapping | null> {
  const cached = mappingCache.get(liveEventId);
  if (cached && Date.now() - cached.cachedAt < MAPPING_TTL_MS) return cached.mapping;

  const resultsEventId = await getResultsEventId(liveEventId);
  if (!resultsEventId) return null;

  const [liveStages, resultsStages] = await Promise.all([
    getLiveStages(liveEventId),
    getResultsStages(resultsEventId),
  ]);

  // Live stages include transit legs (isTransit true) interleaved with actual special stages.
  // Results API stages are competitive stages only. Filter live stages to competitive ones
  // and align by order.
  const competitiveLive = liveStages.filter((s) => !s.isTransit).sort((a, b) => a.order - b.order);

  const liveStageNumberToResultsStageId = new Map<number, number>();
  const liveStageNumberToName = new Map<number, string>();

  for (let i = 0; i < competitiveLive.length && i < resultsStages.length; i++) {
    const live = competitiveLive[i];
    const result = resultsStages[i];
    liveStageNumberToResultsStageId.set(live.number, result.stageId);
    // live.name from rc.statusas.com already includes "SS4" style prefixes (e.g. "SS4 Steamboat 2"),
    // so don't prepend another "SS{number}" on top of it.
    const alreadyPrefixed = /^SS\d+\b/i.test(live.name);
    liveStageNumberToName.set(live.number, alreadyPrefixed ? live.name : `SS${live.number} ${live.name}`);
  }

  const mapping: StageMapping = {
    resultsEventId,
    rallyId,
    liveStageNumberToResultsStageId,
    liveStageNumberToName,
  };
  mappingCache.set(liveEventId, { mapping, cachedAt: Date.now() });
  return mapping;
}

/**
 * Finds the "prior pass" stage for a repeat-visit stage (e.g. SS4 is often a second run of
 * the same road as SS2). We detect this heuristically: two stages with the same base name
 * (stripping trailing " 2", " Two" etc) run earlier in the event.
 */
function findPriorPassStageNumber(
  liveStageNumberToName: Map<number, string>,
  currentStageNumber: number
): number | null {
  const currentName = liveStageNumberToName.get(currentStageNumber);
  if (!currentName) return null;
  const baseName = currentName.replace(/^SS\d+\s+/, "").replace(/\s*2$/, "").trim();
  for (const [num, name] of liveStageNumberToName.entries()) {
    if (num >= currentStageNumber) continue;
    const otherBase = name.replace(/^SS\d+\s+/, "").replace(/\s*2$/, "").trim();
    if (otherBase === baseName) return num;
  }
  return null;
}

async function getEntriesForScope(
  resultsEventId: number,
  rallyId: number,
  classScopeOnly: boolean,
  carClass: string
): Promise<ResultsEntry[]> {
  const entries = await getRallyEntries(resultsEventId, rallyId);
  if (!classScopeOnly) return entries;
  return entries.filter((e) => e.eventClasses?.some((c) => c.name === carClass));
}

export async function buildStageTimesMessage(
  sub: CarSubscription,
  liveStageNumber: number
): Promise<string | null> {
  const mappingForFind = await findEntryByCarNumberCached(sub);
  if (!mappingForFind) return null;
  const { resultsEventId, rallyId, resultsEntryId } = mappingForFind;

  const mapping = await getStageMapping(sub.eventId, rallyId);
  if (!mapping) return null;

  const stageId = mapping.liveStageNumberToResultsStageId.get(liveStageNumber);
  const stageName = mapping.liveStageNumberToName.get(liveStageNumber);
  if (!stageId || !stageName) return null;

  const allTimes = await getStageTimes(resultsEventId, stageId, rallyId);
  const myTime = allTimes.find((t) => t.entryId === resultsEntryId);
  if (!myTime || myTime.status !== "Completed") return null;

  const scopedEntries = await getEntriesForScope(resultsEventId, rallyId, sub.classScopeOnly, sub.carClass);
  const scopedEntryIds = new Set(scopedEntries.map((e) => e.entryId));
  const scopedTimes = allTimes
    .filter((t) => scopedEntryIds.has(t.entryId) && t.status === "Completed")
    .sort((a, b) => a.position - b.position);

  // Re-derive position within scope if class-filtered (results API positions are always overall)
  const myScopedIndex = scopedTimes.findIndex((t) => t.entryId === resultsEntryId);
  const aheadOfMe = myScopedIndex > 0 ? scopedTimes.slice(Math.max(0, myScopedIndex - 3), myScopedIndex) : [];
  const entriesById = new Map(scopedEntries.map((e) => [e.entryId, e]));

  const aheadWithEntries: { entry: ResultsEntry; time: StageTime }[] = aheadOfMe
    .slice()
    .reverse() // closest-to-me first
    .map((t) => ({ entry: entriesById.get(t.entryId)!, time: t }))
    .filter((x) => x.entry);

  let priorPass: { stageName: string; time: StageTime } | null = null;
  const priorStageNumber = findPriorPassStageNumber(mapping.liveStageNumberToName, liveStageNumber);
  if (priorStageNumber) {
    const priorStageId = mapping.liveStageNumberToResultsStageId.get(priorStageNumber);
    const priorStageName = mapping.liveStageNumberToName.get(priorStageNumber);
    if (priorStageId && priorStageName) {
      const priorTimes = await getStageTimes(resultsEventId, priorStageId, rallyId);
      const priorMyTime = priorTimes.find((t) => t.entryId === resultsEntryId);
      if (priorMyTime && priorMyTime.status === "Completed") {
        priorPass = { stageName: priorStageName, time: priorMyTime };
      }
    }
  }

  return stageTimesMessage({
    sub,
    stageName,
    myTime,
    priorPass,
    aheadOfMe: aheadWithEntries,
  });
}

export async function buildOverallTimeMessage(
  sub: CarSubscription,
  liveStageNumber: number
): Promise<string | null> {
  const mappingForFind = await findEntryByCarNumberCached(sub);
  if (!mappingForFind) return null;
  const { resultsEventId, rallyId, resultsEntryId } = mappingForFind;

  const mapping = await getStageMapping(sub.eventId, rallyId);
  if (!mapping) return null;

  const stageId = mapping.liveStageNumberToResultsStageId.get(liveStageNumber);
  const stageName = mapping.liveStageNumberToName.get(liveStageNumber);
  if (!stageId || !stageName) return null;

  const allResults = await getStageResults(resultsEventId, stageId, rallyId);
  const myResult = allResults.find((r) => r.entryId === resultsEntryId);
  if (!myResult) return null;

  const scopedEntries = await getEntriesForScope(resultsEventId, rallyId, sub.classScopeOnly, sub.carClass);
  const scopedEntryIds = new Set(scopedEntries.map((e) => e.entryId));
  const scopedResults = allResults
    .filter((r) => scopedEntryIds.has(r.entryId))
    .sort((a, b) => a.totalTimeMs - b.totalTimeMs);

  const myScopedIndex = scopedResults.findIndex((r) => r.entryId === resultsEntryId);
  const entriesById = new Map(scopedEntries.map((e) => [e.entryId, e]));

  const ahead = scopedResults
    .slice(Math.max(0, myScopedIndex - 3), myScopedIndex)
    .reverse()
    .map((r) => ({ entry: entriesById.get(r.entryId)!, result: r }))
    .filter((x) => x.entry);

  const behind = scopedResults
    .slice(myScopedIndex + 1, myScopedIndex + 4)
    .map((r) => ({ entry: entriesById.get(r.entryId)!, result: r }))
    .filter((x) => x.entry);

  return overallTimeMessage({ sub, stageName, myResult, ahead, behind });
}

// Cache car-number -> results entryId/rallyId lookups (rare to change mid-event)
const entryLookupCache = new Map<
  string,
  { resultsEventId: number; rallyId: number; resultsEntryId: number }
>();

async function findEntryByCarNumberCached(sub: CarSubscription) {
  const cacheKey = `${sub.eventId}:${sub.carNumber}`;
  const cached = entryLookupCache.get(cacheKey);
  if (cached) return cached;

  const resultsEventId = await getResultsEventId(sub.eventId);
  if (!resultsEventId) return null;
  const found = await findEntryByCarNumber(resultsEventId, sub.carNumber);
  if (!found) return null;

  const result = {
    resultsEventId,
    rallyId: found.rallyId,
    resultsEntryId: found.entry.entryId,
  };
  entryLookupCache.set(cacheKey, result);
  return result;
}

export { getEventDetails as getResultsEventDetails };

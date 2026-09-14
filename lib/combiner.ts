import { rankByFieldDistance } from "./overall-rank";
import { accumulateOverall } from "./overall-math";
// Same underlying RallySafe data, pre-aggregated per stage across the whole rally -- used here
// purely to compute REAL overall live standings, since RallySafe's own results app only shows
// per-stage times/splits, not a running overall classification.
//
// The site itself (sneakattackrally.com) blocks iframe embedding (X-Frame-Options: SAMEORIGIN),
// so we fetch its public JSON data file server-side (no CORS headers either) and render our
// own table from it client-side.

export interface CombinerStage {
  name: string;
  length: number;
  splits: number[];
  firstCar: string;
  status: string; // "Waiting" | "Hot" | "Live" | "Completed" | "Cancelled"
  predicted: number;
}

export interface CombinerPenalty {
  control: string;
  stage: number;
  time: string; // duration string, e.g. "10.0" or "1:40.0" — always a positive duration
  reason: string; // free text, e.g. "1 minute late" or "time reduced on appeal"
  numbers?: number[];
}

export interface CombinerEntry {
  number: number;
  carClass: string;
  carModel: string;
  category: string; // e.g. "National" | "Regional" | "STRYKER Challenge" (a separate support series)
  driverUID: number;
  codriverUID: number;
  sf: number; // speed factor
  penalties: CombinerPenalty[];
  retirements: unknown[];
  times: string[]; // one per stage, "" if not yet run/DNS, "M:SS.d" or "SS.d" format
  splits: string[][];
}

interface UidEntry {
  uid: number;
  f: string; // first name
  l: string; // last name
}

const UID_CACHE_TTL_MS = 5 * 60_000; // names rarely change; cache longer than the live data
let uidCache: { data: UidEntry[]; fetchedAt: number } | null = null;

async function fetchUidTable(): Promise<UidEntry[]> {
  if (uidCache && Date.now() - uidCache.fetchedAt < UID_CACHE_TTL_MS) return uidCache.data;
  const res = await fetch("https://sneakattackrally.com/ARACombinerThing/data/uidsSmall.json", {
    cache: "no-store",
  });
  if (!res.ok) return uidCache?.data ?? [];
  const data: UidEntry[] = await res.json();
  uidCache = { data, fetchedAt: Date.now() };
  return data;
}

function nameFor(uids: UidEntry[], uid: number): string {
  const entry = uids[uid];
  if (!entry) return "Unknown";
  const full = `${entry.f ?? ""} ${entry.l ?? ""}`.trim();
  return full || "Unknown";
}

export interface CombinerServiceEntry {
  serviceNumber: number;
  number: number; // car number
  due: string; // ISO timestamp, predicted arrival at this service
}

export interface CombinerData {
  slug: string;
  title: string;
  startDate: string;
  finishDate: string;
  stages: CombinerStage[];
  entries: CombinerEntry[];
  serviceIn: CombinerServiceEntry[];
  timeZone: string;
}

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { data: CombinerData; fetchedAt: number }>();

/** Tries event1..event6 slugs and returns the one whose title matches (case-insensitive,
 * partial match) the given RallySafe event name. Returns null if none match. */
export async function findCombinerEventByName(eventName: string): Promise<CombinerData | null> {
  const needle = eventName.toLowerCase().trim();
  for (let i = 1; i <= 6; i++) {
    const slug = `event${i}`;
    const data = await fetchCombinerSlug(slug);
    if (!data) continue;
    const title = (data.title ?? "").toLowerCase();
    if (title.includes(needle) || needle.includes(title.replace(/^\d{4}\s+/, ""))) {
      return data;
    }
  }
  return null;
}

async function fetchCombinerSlug(slug: string): Promise<CombinerData | null> {
  const cached = cache.get(slug);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

  // The Sneak Attack feed occasionally goes momentarily empty/null mid-event (observed:
  // valid JSON body literally `null` with a 200 status, not an error). A single miss here
  // used to silently disqualify the whole event from being treated as ARA for the rest of
  // that page load, which then routed it into the far less trustworthy raw-stage fallback.
  // One quick retry catches a blip without risking the route's time budget — this function
  // can be called up to 6x per event across a whole event list, so keep it cheap.
  let lastData: CombinerData | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`https://sneakattackrally.com/ARACombinerThing/data/live/${slug}.json`, {
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = (await res.json()) as CombinerData | null;
      if (data && data.title) {
        lastData = data;
        break;
      }
    } catch {
      // fall through to retry
    }
  }
  if (!lastData) return null;
  cache.set(slug, { data: lastData, fetchedAt: Date.now() });
  return lastData;
}

/** Parses a time string like "17:50.5" or "39.0" (seconds only) into milliseconds.
 * Returns null for empty/invalid entries (not-yet-run, DNS, etc). */
function parseTimeToMs(t: string): number | null {
  if (!t || t.trim() === "") return null;
  const parts = t.split(":");
  try {
    if (parts.length === 2) {
      const [m, s] = parts;
      return (Number(m) * 60 + Number(s)) * 1000;
    }
    const s = Number(parts[0]);
    if (Number.isNaN(s)) return null;
    return s * 1000;
  } catch {
    return null;
  }
}

export function msToClock(ms: number): string {
  const totalSec = ms / 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
  }
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** Parses a penalty duration string like "10.0" or "1:40.0" or "6:00.0" into whole seconds
 * (always non-negative — the sign/direction is determined separately from the reason text). */
function parsePenaltyDurationSeconds(t: string): number {
  if (!t) return 0;
  const parts = t.split(":");
  if (parts.length === 2) {
    const [m, s] = parts;
    return Math.round(Number(m) * 60 + Number(s));
  }
  const s = Number(parts[0]);
  return Number.isNaN(s) ? 0 : Math.round(s);
}

/** Time reduced on appeal/review is rare but real (e.g. a wrongly-issued penalty overturned).
 * We detect it from the reason text since the feed always reports a positive duration string;
 * anything mentioning a reduction/appeal/credit is treated as time given BACK (net negative),
 * everything else (late/early/etc) is time ADDED (net positive). */
function isTimeReducedReason(reason: string): boolean {
  const r = (reason ?? "").toLowerCase();
  return /reduc|appeal|credit|given back|overturn|rescind/.test(r);
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
  /** Net penalty seconds: positive = time added (bad), negative = time reduced on appeal (good).
   * Zero when isPenalized is false. */
  penaltySecondsNet: number;
  board?: "national" | "regional";
}

/** Overall from live combiner: times + penalties; cancelled stages stay numbered but add no time. */
export async function computeOverallStandings(data: CombinerData): Promise<OverallStanding[]> {
  const uids = await fetchUidTable();
  const rows: OverallStanding[] = [];
  const stagesTotal = data.stages.length;

  for (const entry of data.entries) {
    const timesMs = data.stages.map((_, y) => parseTimeToMs(entry.times[y] ?? ""));
    const scored = accumulateOverall(
      data.stages.map((s) => s.status || ""),
      timesMs
    );
    if (!scored) continue;
    const totalMsBase = scored.totalMs;
    const lastStage = scored.lastStage;

    const penalties = entry.penalties ?? [];
    const penaltySecondsNet = penalties.reduce((sum, p) => {
      const secs = parsePenaltyDurationSeconds(p.time);
      return sum + (isTimeReducedReason(p.reason) ? -secs : secs);
    }, 0);

    const board: "national" | "regional" = /^national$/i.test(entry.category ?? "")
      ? "national"
      : "regional";

    rows.push({
      position: 0,
      number: entry.number,
      carClass: entry.carClass,
      carModel: entry.carModel,
      driverName: nameFor(uids, entry.driverUID),
      codriverName: nameFor(uids, entry.codriverUID),
      stagesCompleted: lastStage,
      stagesTotal,
      totalMs: totalMsBase + penaltySecondsNet * 1000,
      gapToLeaderMs: 0,
      gapToAheadMs: 0,
      isRetired: (entry.retirements ?? []).length > 0,
      isPenalized: penalties.length > 0,
      penaltySecondsNet,
      board,
    });
  }

  const national = rankByFieldDistance(rows.filter((r) => r.board === "national"));
  const regional = rankByFieldDistance(rows.filter((r) => r.board === "regional"));
  return [...national, ...regional];
}

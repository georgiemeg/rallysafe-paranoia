// Server-side proxy + computation for the Sneak Attack Rally "ARA Combiner" live JSON feed.
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

  const res = await fetch(`https://sneakattackrally.com/ARACombinerThing/data/live/${slug}.json`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  let data: CombinerData | null = null;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  if (!data || !data.title) return null;
  cache.set(slug, { data, fetchedAt: Date.now() });
  return data;
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
  totalMs: number;
  gapToLeaderMs: number;
  gapToAheadMs: number;
  isRetired: boolean;
  isPenalized: boolean;
  /** Net penalty seconds: positive = time added (bad), negative = time reduced on appeal (good).
   * Zero when isPenalized is false. */
  penaltySecondsNet: number;
}

/** Computes running overall totals from every completed-stage time for every entry,
 * sorted ascending by total time. Cars with retirements are pushed to the bottom but
 * still shown (marked isRetired) rather than silently dropped. */
export async function computeOverallStandings(data: CombinerData): Promise<OverallStanding[]> {
  const uids = await fetchUidTable();
  const rows: OverallStanding[] = [];

  for (const entry of data.entries) {
    // STRYKER Challenge is a separate support series with its own shorter-stage format;
    // it is NOT part of the main National/Regional overall classification (confirmed against
    // the source site's own "Single table" view, which excludes it entirely).
    if (entry.category === "STRYKER Challenge") continue;

    let totalMs = 0;
    let stagesCompleted = 0;
    for (const t of entry.times) {
      const ms = parseTimeToMs(t);
      if (ms !== null) {
        totalMs += ms;
        stagesCompleted++;
      }
    }
    if (stagesCompleted === 0) continue; // hasn't started, skip entirely

    const penalties = entry.penalties ?? [];
    const penaltySecondsNet = penalties.reduce((sum, p) => {
      const secs = parsePenaltyDurationSeconds(p.time);
      return sum + (isTimeReducedReason(p.reason) ? -secs : secs);
    }, 0);

    rows.push({
      position: 0,
      number: entry.number,
      carClass: entry.carClass,
      carModel: entry.carModel,
      driverName: nameFor(uids, entry.driverUID),
      codriverName: nameFor(uids, entry.codriverUID),
      stagesCompleted,
      totalMs,
      gapToLeaderMs: 0,
      gapToAheadMs: 0,
      isRetired: (entry.retirements ?? []).length > 0,
      isPenalized: penalties.length > 0,
      penaltySecondsNet,
    });
  }

  // Running cars first (by time), retired cars after (also by time, informational only)
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

  return rows;
}

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

export interface CombinerEntry {
  number: number;
  carClass: string;
  carModel: string;
  category: string;
  driverUID: number;
  codriverUID: number;
  sf: number; // speed factor
  penalties: unknown[];
  retirements: unknown[];
  times: string[]; // one per stage, "" if not yet run/DNS, "M:SS.d" or "SS.d" format
  splits: string[][];
}

export interface CombinerData {
  slug: string;
  title: string;
  startDate: string;
  finishDate: string;
  stages: CombinerStage[];
  entries: CombinerEntry[];
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

export interface OverallStanding {
  position: number;
  number: number;
  carClass: string;
  carModel: string;
  stagesCompleted: number;
  totalMs: number;
  gapToLeaderMs: number;
  gapToAheadMs: number;
  isRetired: boolean;
  isPenalized: boolean;
}

/** Computes running overall totals from every completed-stage time for every entry,
 * sorted ascending by total time. Cars with retirements are pushed to the bottom but
 * still shown (marked isRetired) rather than silently dropped. */
export function computeOverallStandings(data: CombinerData): OverallStanding[] {
  const rows: OverallStanding[] = [];

  for (const entry of data.entries) {
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

    rows.push({
      position: 0,
      number: entry.number,
      carClass: entry.carClass,
      carModel: entry.carModel,
      stagesCompleted,
      totalMs,
      gapToLeaderMs: 0,
      gapToAheadMs: 0,
      isRetired: (entry.retirements ?? []).length > 0,
      isPenalized: (entry.penalties ?? []).length > 0,
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

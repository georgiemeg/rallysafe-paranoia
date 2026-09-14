import entriesSeed from "@/lib/sim/seed/entries.json";
import itinerarySeed from "@/lib/sim/seed/itinerary.json";
import stageTimesSeed from "@/lib/sim/seed/stageTimes.json";

export const ARA_FIRST_START_MS = 2 * 60 * 1000;
export const PRE_SS1_MS = 13 * 60 * 1000;

export type SegKind = "transit" | "stage" | "service" | "regroup" | "overnight";

export type AfterStep = {
  kind: SegKind;
  min: number;
  from?: string;
  to?: string;
  name?: string;
};

export type TrackSeg = {
  kind: SegKind;
  stage: number;
  label: string;
  from?: string;
  to?: string;
  startMs: number;
  durationMs: number;
};

export type PlaybackCar = {
  number: string;
  segs: TrackSeg[];
  cursor: number;
  delayMs: number;
  holdUntilElapsed: number;
  holdProgress: number;
  retired: boolean;
  passBy?: string;
  firedStarts?: number[];
  firedFinishes?: number[];
};

export type Playback = {
  mode: "stage" | "event";
  stage: number;
  t0: number;
  order: string[];
  cars: PlaybackCar[];
  reseededNights: number[];
  frozenElapsed?: number;
  elapsedMs?: number;
  lastTickAt?: number;
};

type Itin = {
  n: number;
  name: string;
  cancelled?: boolean;
  after?: AfterStep[];
  transitAfterMin?: number;
};

export function clockToMs(raw: string): number {
  const t = (raw || "").trim();
  if (!t || /^dnf/i.test(t) || t.includes("--")) return 0;
  const p = t.split(":").map(Number);
  if (p.some((n) => !Number.isFinite(n))) return 0;
  if (p.length === 3) return Math.round(((p[0] * 60 + p[1]) * 60 + p[2]) * 1000);
  if (p.length === 2) return Math.round((p[0] * 60 + p[1]) * 1000);
  return Math.round(p[0] * 1000);
}

function nextName(itinerary: Itin[], n: number): string {
  const nxt = itinerary.find((s) => s.n > n);
  return nxt ? `SS${nxt.n}` : "Finish MTC";
}

function afterSteps(s: Itin, itinerary: Itin[]): AfterStep[] {
  if (s.after?.length) return s.after;
  const min = s.transitAfterMin ?? 12;
  const last = !itinerary.some((x) => x.n > s.n);
  return [{ kind: "transit", min, from: `SS${s.n}`, to: last ? "Finish MTC" : nextName(itinerary, s.n) }];
}

function pushSegsForStage(
  segs: TrackSeg[],
  t: number,
  s: Itin,
  itinerary: Itin[],
  car: string,
  times: Record<string, Record<string, string>>,
  cancelled: Set<number>
): number {
  // A cancelled stage skips only the driving time — the transit/service/overnight
  // steps scheduled after it must still run. Otherwise cancelling a stage right
  // before an overnight break wipes that break entirely, collapsing the day
  // boundary and causing a later stage (real day 2+) to start at the same
  // elapsed time as an earlier stage on day 1 — two stages overlapping that
  // never should.
  if (cancelled.has(s.n)) {
    for (const a of afterSteps(s, itinerary)) {
      const label =
        a.kind === "service"
          ? `${a.name || "Service"} (${a.min} min)`
          : a.kind === "overnight"
            ? `${a.name || "Overnight parc fermé"} (${a.min} min)`
            : a.kind === "regroup"
              ? `${a.name || "Regroup"} (${a.min} min)`
              : `${a.from || `SS${s.n}`} → ${a.to || nextName(itinerary, s.n)} (${a.min} min)`;
      segs.push({
        kind: a.kind,
        stage: s.n,
        label,
        from: a.from || `SS${s.n}`,
        to: a.to || nextName(itinerary, s.n),
        startMs: t,
        durationMs: a.min * 60 * 1000,
      });
      t += a.min * 60 * 1000;
    }
    return t;
  }
  const raw = times[String(s.n)]?.[car];
  const dur = clockToMs(raw || "");
  if (!dur) return t;
  segs.push({ kind: "stage", stage: s.n, label: s.name, from: `SS${s.n} start`, to: `SS${s.n} finish`, startMs: t, durationMs: dur });
  t += dur;
  for (const a of afterSteps(s, itinerary)) {
    const label =
      a.kind === "service"
        ? `${a.name || "Service"} (${a.min} min)`
        : a.kind === "overnight"
          ? `${a.name || "Overnight parc fermé"} (${a.min} min)`
          : a.kind === "regroup"
            ? `${a.name || "Regroup"} (${a.min} min)`
            : `${a.from || `SS${s.n}`} → ${a.to || nextName(itinerary, s.n)} (${a.min} min)`;
    segs.push({
      kind: a.kind,
      stage: s.n,
      label,
      from: a.from || `SS${s.n}`,
      to: a.to || nextName(itinerary, s.n),
      startMs: t,
      durationMs: a.min * 60 * 1000,
    });
    t += a.min * 60 * 1000;
  }
  return t;
}

export function buildCarTimelines(opts: {
  fromStage: number;
  toStage: number;
  preTransit: boolean;
  retired?: string[];
  cancelled?: number[];
  order?: string[];
}): PlaybackCar[] {
  const times = stageTimesSeed as Record<string, Record<string, string>>;
  const itinerary = itinerarySeed as Itin[];
  const retired = new Set(opts.retired || []);
  const cancelled = new Set(opts.cancelled || []);
  const roster = opts.order?.length
    ? opts.order.filter((n) => (entriesSeed as { number: string }[]).some((e) => e.number === n))
    : (entriesSeed as { number: string }[]).map((e) => e.number);
  const cars = roster
    .filter((n) => !retired.has(n))
    .map((number, i) => {
      const segs: TrackSeg[] = [];
      let t = i * ARA_FIRST_START_MS;
      if (opts.preTransit && opts.fromStage <= 1) {
        segs.push({
          kind: "transit",
          stage: 1,
          label: `MTC OUT → SS1 (13 min)`,
          from: "MTC OUT",
          to: "SS1",
          startMs: t,
          durationMs: PRE_SS1_MS,
        });
        t += PRE_SS1_MS;
      }
      for (const s of itinerary) {
        if (s.n < opts.fromStage || s.n > opts.toStage) continue;
        t = pushSegsForStage(segs, t, s, itinerary, number, times, cancelled);
      }
      return { number, segs, cursor: -1, delayMs: 0, holdUntilElapsed: 0, holdProgress: 0, retired: false, firedStarts: [] as number[], firedFinishes: [] as number[] };
    })
    .filter((c) => c.segs.length > 0);
  applyTwoPassGates(cars, itinerary);
  return cars;
}

function stageFamily(name: string): { family: string; pass: number } {
  const stripped = name.replace(/^SS\d+\s+/i, "").trim();
  const m = stripped.match(/^(.*)\s+(\d+)$/);
  if (m) return { family: m[1].trim().toLowerCase(), pass: Number(m[2]) };
  return { family: stripped.toLowerCase(), pass: 1 };
}

function shiftFromIndex(car: PlaybackCar, from: number, deltaMs: number) {
  if (!deltaMs) return;
  for (let i = from; i < car.segs.length; i++) {
    car.segs[i] = { ...car.segs[i], startMs: car.segs[i].startMs + deltaMs };
  }
}

/** Pass 2+ of the same road stays closed until every running car has finished the previous pass, then 2-min start gaps. */
function applyTwoPassGates(cars: PlaybackCar[], itinerary: Itin[]) {
  const meta = itinerary.map((s) => ({ n: s.n, ...stageFamily(s.name) }));
  for (const s of meta) {
    if (s.pass < 2) continue;
    const prev = [...meta].reverse().find((x) => x.family === s.family && x.pass === s.pass - 1);
    if (!prev) continue;
    let lastFinish = 0;
    let any = false;
    for (const c of cars) {
      const seg = c.segs.find((g) => g.kind === "stage" && g.stage === prev.n);
      if (!seg) continue;
      any = true;
      lastFinish = Math.max(lastFinish, seg.startMs + seg.durationMs);
    }
    if (!any) continue;
    const gate = lastFinish + 60_000;
    for (const c of cars) {
      const idx = c.segs.findIndex((g) => g.kind === "stage" && g.stage === s.n);
      if (idx < 0) continue;
      const need = gate - c.segs[idx].startMs;
      if (need > 0) shiftFromIndex(c, idx, need);
    }
    const starters = cars
      .map((c) => ({ c, idx: c.segs.findIndex((g) => g.kind === "stage" && g.stage === s.n) }))
      .filter((x) => x.idx >= 0)
      .sort((a, b) => a.c.segs[a.idx].startMs - b.c.segs[b.idx].startMs || Number(a.c.number) - Number(b.c.number));
    let prevStart = -ARA_FIRST_START_MS;
    for (const x of starters) {
      const start = x.c.segs[x.idx].startMs;
      const minStart = prevStart + ARA_FIRST_START_MS;
      if (start < minStart) shiftFromIndex(x.c, x.idx, minStart - start);
      prevStart = x.c.segs[x.idx].startMs;
    }
  }
}

export function finishedStages(car: PlaybackCar, elapsedMs: number): number[] {
  const t = effectiveElapsed(car, elapsedMs);
  const out: number[] = [];
  for (const s of car.segs) {
    if (s.kind !== "stage") continue;
    if (t >= s.startMs + s.durationMs) out.push(s.stage);
  }
  return out;
}

export function effectiveElapsed(car: PlaybackCar, elapsedMs: number): number {
  if (car.retired) return Number.POSITIVE_INFINITY;
  if (elapsedMs < car.holdUntilElapsed) {
    const at = segAtRaw(car, Math.max(0, car.holdUntilElapsed - 1 - car.delayMs));
    return at.seg ? at.seg.startMs + at.progress * at.seg.durationMs : elapsedMs - car.delayMs;
  }
  return Math.max(0, elapsedMs - car.delayMs);
}

function segAtRaw(car: PlaybackCar, elapsedMs: number) {
  if (!car?.segs?.length) return { index: -1, seg: null as TrackSeg | null, progress: 0, done: true, waiting: false };
  const first = car.segs[0];
  if (elapsedMs < first.startMs) return { index: -1, seg: null, progress: 0, done: false, waiting: true };
  const last = car.segs[car.segs.length - 1];
  if (elapsedMs >= last.startMs + last.durationMs) {
    return { index: car.segs.length - 1, seg: last, progress: 1, done: true, waiting: false };
  }
  for (let i = 0; i < car.segs.length; i++) {
    const s = car.segs[i];
    const end = s.startMs + s.durationMs;
    if (elapsedMs < end) {
      const progress = s.durationMs <= 0 ? 1 : Math.min(1, Math.max(0, (elapsedMs - s.startMs) / s.durationMs));
      return { index: i, seg: s, progress, done: false, waiting: false };
    }
  }
  return { index: car.segs.length - 1, seg: last, progress: 1, done: true, waiting: false };
}

export function segAt(car: PlaybackCar, elapsedMs: number) {
  if (car.retired) {
    const seg = (car.cursor >= 0 ? car.segs[car.cursor] : car.segs[0]) || null;
    return { index: car.cursor, seg, progress: car.holdProgress || 0, done: false, waiting: false };
  }
  if (elapsedMs < car.holdUntilElapsed) {
    const frozen = segAtRaw(car, effectiveElapsed(car, car.holdUntilElapsed - 1));
    return { ...frozen, progress: car.holdProgress || frozen.progress, done: false };
  }
  return segAtRaw(car, elapsedMs - car.delayMs);
}

export type TrackDot = {
  number: string;
  driver: string;
  carClass: string;
  kind: SegKind | "waiting" | "done";
  stage: number;
  progress: number;
  label: string;
  from?: string;
  to?: string;
  slot: number;
};

export function dotsFromPlayback(pb: Playback | null, elapsedMs: number): TrackDot[] {
  const crew = entriesSeed as { number: string; driver: string; carClass: string }[];
  if (!pb?.cars?.length) return [];
  const raw = pb.cars.map((c) => {
    const e = crew.find((x) => x.number === c.number);
    const at = segAt(c, elapsedMs);
    if (at.waiting) {
      return { number: c.number, driver: e?.driver || "", carClass: e?.carClass || "", kind: "waiting" as const, stage: 0, progress: 0, label: "MTC OUT", from: "MTC OUT", to: "SS1", slot: 0, _key: "wait" };
    }
    if (!at.seg) {
      return { number: c.number, driver: e?.driver || "", carClass: e?.carClass || "", kind: "done" as const, stage: 19, progress: 1, label: "Finish MTC", from: "SS19", to: "Finish MTC", slot: 0, _key: "done" };
    }
    if (at.done) {
      return { number: c.number, driver: e?.driver || "", carClass: e?.carClass || "", kind: "done" as const, stage: 19, progress: 1, label: "Finish MTC", from: "SS19", to: "Finish MTC", slot: 0, _key: "done" };
    }
    return {
      number: c.number,
      driver: e?.driver || "",
      carClass: e?.carClass || "",
      kind: at.seg.kind,
      stage: at.seg.stage,
      progress: at.progress,
      label: at.seg.label,
      from: at.seg.from,
      to: at.seg.to,
      slot: 0,
      _key: `${at.seg.kind}-${at.seg.stage}-${at.seg.label}`,
    };
  });
  const groups = new Map<string, typeof raw>();
  for (const d of raw) {
    const g = groups.get(d._key) || [];
    g.push(d);
    groups.set(d._key, g);
  }
  const out: TrackDot[] = [];
  for (const g of groups.values()) {
    g.forEach((d, i) => {
      const { _key, ...rest } = d;
      void _key;
      out.push({ ...rest, slot: i, progress: ["service", "regroup", "overnight"].includes(d.kind) ? (i + 1) / (g.length + 1) : d.progress });
    });
  }
  return out;
}

export function overallStageMs(
  car: string,
  throughStage: number,
  cancelled: number[],
  posted?: Record<string, Record<string, number>>
): number {
  const skip = new Set(cancelled);
  let tot = 0;
  for (let n = 1; n <= throughStage; n++) {
    if (skip.has(n)) continue;
    tot += posted?.[String(n)]?.[car] || 0;
  }
  return tot;
}

export function reseedOrder(
  cars: string[],
  throughStage: number,
  cancelled: number[],
  original: string[],
  posted?: Record<string, Record<string, number>>
): string[] {
  return [...cars].sort((a, b) => {
    const da = overallStageMs(a, throughStage, cancelled, posted);
    const db = overallStageMs(b, throughStage, cancelled, posted);
    if (da !== db) return da - db;
    return original.indexOf(a) - original.indexOf(b);
  });
}

export function overnightSkip(pb: Playback | null, elapsedMs: number): { label: string; targetElapsedMs: number } | null {
  if (!pb?.cars?.length) return null;
  const live = pb.cars.filter((c) => !c.retired);
  if (!live.length) return null;
  const ats = live.map((c) => ({ c, at: segAt(c, elapsedMs) }));
  if (!ats.every((x) => x.at.seg?.kind === "overnight")) return null;
  const night = ats[0].at.seg!;
  const firstOut = Math.min(
    ...ats.map((x) => {
      const seg = x.at.seg!;
      return seg.startMs + seg.durationMs;
    })
  );
  const targetElapsedMs = firstOut - 30 * 60 * 1000;
  if (elapsedMs >= targetElapsedMs) return null;
  return { label: night.label, targetElapsedMs };
}

export function shiftFutureStarts(car: PlaybackCar, elapsedMs: number, deltaMs: number) {
  const at = segAt(car, elapsedMs);
  const from = at.index + 1;
  for (let i = from; i < car.segs.length; i++) {
    car.segs[i] = { ...car.segs[i], startMs: car.segs[i].startMs + deltaMs };
  }
}

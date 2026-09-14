import { ensureUserSchema, getPool } from "@/lib/db";
import { TEST_EVENT_ID, TEST_EVENT_NAME } from "@/lib/sim/ids";
import entriesSeed from "@/lib/sim/seed/entries.json";
import itinerarySeed from "@/lib/sim/seed/itinerary.json";
import stageTimesSeed from "@/lib/sim/seed/stageTimes.json";
import finalsSeed from "@/lib/sim/seed/finalOverall.json";
import serviceSeed from "@/lib/sim/seed/servicePark.json";
import type { RSEntry, RSStage } from "@/lib/rallysafe";
import { ARA_FIRST_START_MS, buildCarTimelines, dotsFromPlayback, finishedStages, overnightSkip, reseedOrder, segAt, shiftFutureStarts, type Playback, type PlaybackCar } from "@/lib/sim/track";
import { rankByFieldDistance } from "@/lib/overall-rank";

export type { Playback, PlaybackCar };
export { dotsFromPlayback, segAt };

export type SimPacket = {
  racingStatus: number;
  stageNumber: number;
  lat: number;
  lng: number;
  speed: number;
  lastMessageTimestamp: string;
  stageTimeMs?: number;
};

export type SimState = {
  completed: number;
  playing: boolean;
  speed: number;
  smsLive: boolean;
  selectedCar: string;
  selectedCars: string[];
  retired: string[];
  penalties: Record<string, number>;
  stopped: string[];
  staleGps: string[];
  sos: string[];
  packets: Record<string, SimPacket>;
  playback: Playback | null;
  cancelled: number[];
  postedTimes: Record<string, Record<string, number>>;
};

const DEFAULT: SimState = {
  completed: 0,
  playing: false,
  speed: 1,
  smsLive: false,
  selectedCar: "1",
  selectedCars: ["1"],
  retired: [],
  penalties: {},
  stopped: [],
  staleGps: [],
  sos: [],
  packets: {},
  playback: null,
  cancelled: [],
  postedTimes: {},
};

function clockToMs(raw: string): number {
  const t = (raw || "").trim();
  if (!t || /^dnf/i.test(t) || t.includes("--")) return 0;
  const p = t.split(":").map(Number);
  if (p.some((n) => !Number.isFinite(n))) return 0;
  if (p.length === 3) return Math.round(((p[0] * 60 + p[1]) * 60 + p[2]) * 1000);
  if (p.length === 2) return Math.round((p[0] * 60 + p[1]) * 1000);
  return Math.round(p[0] * 1000);
}

function officialPenaltySec(car: string): number {
  const row = (finalsSeed as { number: string; penalty: string }[]).find((r) => r.number === car);
  if (!row || /^dnf/i.test(row.penalty || "")) return 0;
  return Math.round(clockToMs(row.penalty) / 1000);
}

function lastOfficialStage(car: string): number {
  const times = stageTimesSeed as Record<string, Record<string, string>>;
  let last = 0;
  for (let n = 1; n <= 19; n++) {
    if (times[String(n)]?.[car]) last = n;
  }
  return last;
}

async function ensureSim() {
  await ensureUserSchema();
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS sim_state (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS irregularities (
      id TEXT PRIMARY KEY,
      t BIGINT NOT NULL,
      severity TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      event_id TEXT
    );
  `);
}

export async function getSimState(): Promise<SimState> {
  await ensureSim();
  const res = await getPool().query(`SELECT payload FROM sim_state WHERE id = 'otr2025'`);
  const payload = (res.rows[0]?.payload ?? {}) as Partial<SimState>;
  const playback = payload.playback;
  const ok =
    playback &&
    Array.isArray(playback.cars) &&
    playback.cars.every((c) => Array.isArray((c as PlaybackCar).segs));
  const selectedCar = String(payload.selectedCar || DEFAULT.selectedCar);
  const selectedCars = Array.isArray(payload.selectedCars) && payload.selectedCars.length
    ? payload.selectedCars.map(String)
    : [selectedCar];
  return { ...DEFAULT, ...payload, selectedCar, selectedCars, playback: ok ? playback : null, playing: ok ? Boolean(payload.playing) : false };
}

export async function setSimState(patch: Partial<SimState>): Promise<SimState> {
  const cur = await getSimState();
  const next = { ...cur, ...patch };
  await getPool().query(
    `INSERT INTO sim_state (id, payload, updated_at) VALUES ('otr2025', $1::jsonb, $2)
     ON CONFLICT (id) DO UPDATE SET payload = $1::jsonb, updated_at = $2`,
    [JSON.stringify(next), Date.now()]
  );
  return next;
}

async function replaceSimState(next: SimState): Promise<SimState> {
  await ensureSim();
  await getPool().query(
    `INSERT INTO sim_state (id, payload, updated_at) VALUES ('otr2025', $1::jsonb, $2)
     ON CONFLICT (id) DO UPDATE SET payload = $1::jsonb, updated_at = $2`,
    [JSON.stringify(next), Date.now()]
  );
  return next;
}

export async function logIrregularity(row: { severity: string; source: string; message: string; eventId?: string }) {
  await ensureSim();
  await getPool().query(
    `INSERT INTO irregularities (id, t, severity, source, message, event_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [crypto.randomUUID(), Date.now(), row.severity, row.source, row.message, row.eventId ?? String(TEST_EVENT_ID)]
  );
}

export async function listIrregularities(limit = 50) {
  await ensureSim();
  const res = await getPool().query(`SELECT * FROM irregularities ORDER BY t DESC LIMIT $1`, [limit]);
  return res.rows;
}

export function simEntries(state?: SimState): RSEntry[] {
  const st = state ?? DEFAULT;
  return (entriesSeed as { number: string; driver: string; navigator: string; carClass: string; car: string }[]).map((e, i) => {
    const [df, ...dr] = e.driver.split(" ");
    const [nf, ...nr] = e.navigator.split(" ");
    const pkt = st.packets[e.number];
    const stopped = st.stopped.includes(e.number);
    const stale = st.staleGps.includes(e.number);
    const lat = pkt?.lat ?? 45.82 + i * 0.001;
    const lng = pkt?.lng ?? -120.82 + i * 0.001;
    return {
      entryId: 9000 + i,
      eventId: TEST_EVENT_ID,
      eventName: TEST_EVENT_NAME,
      identifier: e.number,
      classText: e.carClass,
      vehicle: {
        vehicleId: 8000 + i,
        driverId: 7000 + i,
        driver: { personId: 7000 + i, firstName: df, surname: dr.join(" ") || df },
        navigatorId: 6000 + i,
        navigator: { personId: 6000 + i, firstName: nf, surname: nr.join(" ") || nf },
        make: e.car,
      },
      lat,
      lng,
      bearing: 90,
      speed: pkt?.speed ?? 0,
      lastMessageTimestamp:
        pkt?.lastMessageTimestamp ??
        (stale ? new Date(Date.now() - 60_000).toISOString() : new Date().toISOString()),
      isUnitActive: true,
      stageNumber: pkt?.stageNumber ?? 0,
      racingStatus: pkt?.racingStatus ?? 0,
      stageTimeMs: pkt?.stageTimeMs || 0,
    };
  });
}

export function entryIdForCar(car: string): number {
  const i = (entriesSeed as { number: string }[]).findIndex((e) => e.number === car);
  return i >= 0 ? 9000 + i : 9000;
}

export function crewForCar(car: string) {
  return (entriesSeed as { number: string; driver: string; navigator: string; carClass: string; car: string }[]).find((e) => e.number === car);
}

export async function simStages(): Promise<RSStage[]> {
  const st = await getSimState();
  const out: RSStage[] = [];
  let order = 1;
  for (const s of itinerarySeed as { n: number; name: string; km: number; cancelled: boolean; transitAfterMin?: number; transitNote?: string }[]) {
    let status = 0;
    const userCancelled = (st.cancelled || []).includes(s.n);
    if (userCancelled && st.completed >= s.n) status = 4;
    else if (st.completed >= s.n) status = 4;
    else if (st.completed + 1 === s.n && !userCancelled) status = 2;
    out.push({
      locationGroupId: s.n,
      eventId: TEST_EVENT_ID,
      number: s.n,
      name: s.name,
      length: s.km,
      isTransit: false,
      status,
      order: order++,
    });
    const transitMin = s.transitAfterMin ?? 12;
    const transitDone = st.completed > s.n;
    const transitHot = st.playing && st.completed === s.n;
    out.push({
      locationGroupId: s.n * 100 + 50,
      eventId: TEST_EVENT_ID,
      number: s.n,
      name: `Transit after SS${s.n} (${transitMin} min allotted${s.transitNote ? ` — ${s.transitNote}` : ""})`,
      length: Math.round(transitMin * 0.7),
      isTransit: true,
      status: transitDone ? 4 : transitHot ? 2 : 0,
      order: order++,
    });
  }
  return out;
}

function msClock(ms: number): string {
  const totalSeconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds - minutes * 60).toFixed(1);
  return minutes > 0 ? `${minutes}:${seconds.padStart(4, "0")}` : `${seconds}s`;
}

function postedFor(st: SimState): Record<string, Record<string, number>> {
  return st.postedTimes || {};
}

export async function recordPostedTime(car: string, stage: number, ms: number) {
  if (!ms || stage < 1) return;
  await ensureSim();
  const stageKey = String(stage);
  await getPool().query(
    `UPDATE sim_state SET
       payload = jsonb_set(
         jsonb_set(COALESCE(payload, '{}'::jsonb), '{postedTimes}', COALESCE(payload->'postedTimes', '{}'::jsonb), true),
         ARRAY['postedTimes', $1],
         COALESCE(payload#>ARRAY['postedTimes', $1], '{}'::jsonb) || jsonb_build_object($2::text, $3::int),
         true
       ),
       updated_at = $4
     WHERE id = 'otr2025'`,
    [stageKey, car, Math.round(ms), Date.now()]
  );
}

export async function simOverall(throughStage?: number) {
  const st = await getSimState();
  const posted = postedFor(st);
  const stages = await simStages();
  const entries = entriesSeed as { number: string; driver: string; navigator: string; carClass: string; car: string }[];
  const cap = throughStage ?? 19;
  const rows = entries.map((e) => {
    let totalMs = 0;
    let stagesCompleted = 0;
    for (let n = 1; n <= cap; n++) {
      if ((st.cancelled || []).includes(n)) continue;
      const ms = posted[String(n)]?.[e.number];
      if (!ms) continue;
      totalMs += ms;
      stagesCompleted += 1;
    }
    totalMs += (st.penalties[e.number] || 0) * 1000;
    return {
      position: 0,
      number: Number(e.number),
      carClass: e.carClass,
      carModel: e.car,
      driverName: e.driver,
      codriverName: e.navigator,
      stagesCompleted,
      stagesTotal: 19,
      totalMs,
      gapToLeaderMs: 0,
      gapToAheadMs: 0,
      isRetired: st.retired.includes(e.number),
      isPenalized: Boolean(st.penalties[e.number]),
      penaltySecondsNet: st.penalties[e.number] || 0,
    };
  });
  const standings = rankByFieldDistance(rows);
  const completed = Math.max(0, ...rows.filter((r) => !r.isRetired).map((r) => r.stagesCompleted), st.completed);
  const serviceIn = (serviceSeed as { serviceNumber: number; afterStage: number; due: string; cars: string[] }[])
    .filter((s) => completed >= s.afterStage)
    .flatMap((s) =>
      s.cars
        .filter((n) => (posted[String(s.afterStage)] || {})[n])
        .map((n) => ({ serviceNumber: s.serviceNumber, number: Number(n), due: s.due }))
    );
  return {
    title: TEST_EVENT_NAME,
    stages: stages.filter((s) => !s.isTransit).map((s) => ({
      name: s.name,
      status: (st.cancelled || []).includes(s.number) && st.completed >= s.number
        ? "Cancelled"
        : s.status === 4
          ? "Completed"
          : s.status === 2
            ? "Hot"
            : "Waiting",
      length: s.length,
    })),
    standings,
    serviceIn,
    timeZone: "America/Los_Angeles",
    stagesCompleted: completed,
    latestStage: latestStageFromPosted(st, posted, standings),
  };
}

function latestStageFromPosted(
  st: SimState,
  posted: Record<string, Record<string, number>>,
  standings: { number: number; driverName: string; codriverName: string; carClass: string }[]
) {
  const ns = Object.keys(posted)
    .map(Number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const n = ns[ns.length - 1];
  if (!n) return { stage: 0, name: "", rows: [] as { position: number; number: number; driverName: string; codriverName: string; carClass: string; stagesCompleted: number; totalMs: number; gapToLeaderMs: number; gapToAheadMs: number; isRetired: boolean; isPenalized: boolean; penaltySecondsNet: number }[] };
  const byCar = posted[String(n)] || {};
  const stage = (itinerarySeed as { n: number; name: string }[]).find((s) => s.n === n);
  const rows = standings
    .filter((s) => byCar[String(s.number)])
    .map((s) => {
      const totalMs = byCar[String(s.number)];
      return {
        position: 0,
        number: s.number,
        driverName: s.driverName,
        codriverName: s.codriverName,
        carClass: s.carClass,
        stagesCompleted: 1,
        totalMs,
        gapToLeaderMs: 0,
        gapToAheadMs: 0,
        isRetired: false,
        isPenalized: false,
        penaltySecondsNet: 0,
      };
    })
    .sort((a, b) => a.totalMs - b.totalMs);
  const leader = rows[0]?.totalMs ?? 0;
  rows.forEach((r, i) => {
    r.position = i + 1;
    r.gapToLeaderMs = r.totalMs - leader;
    r.gapToAheadMs = i === 0 ? 0 : r.totalMs - rows[i - 1].totalMs;
  });
  return { stage: n, name: stage?.name || `SS${n}`, rows };
}

export function simServiceEstimatesFor(car: string, afterStage: number) {
  return (serviceSeed as { serviceNumber: number; afterStage: number; due: string; mins?: number; cars: string[] }[])
    .filter((s) => s.afterStage === afterStage && s.cars.includes(String(car)))
    .map((s) => ({ serviceNumber: s.serviceNumber, due: s.due, durationMins: s.mins ?? 20 }));
}

/** All services this car hasn't reached yet (not just the one right after their current
 * stage) — used for on-demand SERVICE CHECK so a car mid-SS3 can still see Service B/C/D
 * coming up later, not just whatever's immediately next. */
export function simUpcomingServiceEstimatesFor(car: string, completedStage: number) {
  return (serviceSeed as { serviceNumber: number; afterStage: number; due: string; mins?: number; cars: string[] }[])
    .filter((s) => s.afterStage > completedStage && s.cars.includes(String(car)))
    .sort((a, b) => a.afterStage - b.afterStage)
    .map((s) => ({ serviceNumber: s.serviceNumber, due: s.due, durationMins: s.mins ?? 20 }));
}

export async function simStageTimesAlert(car: string, stageN: number): Promise<string | null> {
  const st = await getSimState();
  const posted = postedFor(st);
  const byCar = posted[String(stageN)] || {};
  const mineMs = Number((byCar[car] ?? Object.entries(byCar).find(([k]) => String(k) === String(car))?.[1]) || 0);
  if (!mineMs) return null;
  const ranked = Object.entries(byCar)
    .map(([n, ms]) => ({ n, ms }))
    .sort((a, b) => a.ms - b.ms);
  const idx = ranked.findIndex((r) => r.n === car);
  if (idx < 0) return null;
  const stage = (itinerarySeed as { n: number; name: string }[]).find((s) => s.n === stageN);
  const crew = crewForCar(car);
  const pos = idx + 1;
  const lines = [
    `Car #${car} (${crew?.carClass || ""}) — ${stage?.name || `SS${stageN}`}: ${msClock(mineMs)} (${pos}${ordinal(pos)})`,
  ];
  const priorN = priorPassStage(stageN);
  if (priorN) {
    const priorMs = postedFor(st)[String(priorN)]?.[car];
    const priorStage = (itinerarySeed as { n: number; name: string }[]).find((s) => s.n === priorN);
    if (priorMs && priorStage) {
      const priorRanked = Object.entries(postedFor(st)[String(priorN)] || {})
        .sort((a, b) => a[1] - b[1]);
      const priorPos = priorRanked.findIndex((r) => r[0] === car) + 1;
      const delta = mineMs - priorMs;
      lines.push(
        `Previous pass (${priorStage.name}): ${msClock(priorMs)} (${priorPos}${ordinal(priorPos)})`
      );
      lines.push(`↳ ${delta === 0 ? "even" : `${msClock(Math.abs(delta))} ${delta < 0 ? "FASTER 🔼" : "slower 🔽"}`} this time`);
    }
  }
  const ahead = ranked.slice(Math.max(0, idx - 3), idx).reverse();
  if (ahead.length) {
    const ssTag = (stage?.name || `SS${stageN}`).match(/^SS\d+/i)?.[0] ?? `SS${stageN}`;
    lines.push("");
    lines.push(`Cars ahead of #${car} (${crew?.carClass || ""}) on ${ssTag}:`);
    for (const a of ahead) {
      const c = crewForCar(a.n);
      const d = mineMs - a.ms;
      lines.push(
        `#${a.n} ${c?.driver || ""}/${c?.navigator || ""}: ${msClock(a.ms)} (${msClock(Math.abs(d))} ${d >= 0 ? "FASTER 🔼" : "slower 🔽"})`
      );
    }
  }
  const behind = ranked.slice(idx + 1, idx + 4);
  if (behind.length) {
    const ssTag = (stage?.name || `SS${stageN}`).match(/^SS\d+/i)?.[0] ?? `SS${stageN}`;
    lines.push("");
    lines.push(`Cars behind #${car} (${crew?.carClass || ""}) on ${ssTag}:`);
    for (const b of behind) {
      const c = crewForCar(b.n);
      const d = b.ms - mineMs;
      lines.push(
        `#${b.n} ${c?.driver || ""}/${c?.navigator || ""}: ${msClock(b.ms)} (${msClock(Math.abs(d))} ${d >= 0 ? "slower 🔽" : "FASTER 🔼"})`
      );
    }
  }
  return lines.join("\n");
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function priorPassStage(stageN: number): number | null {
  const itin = itinerarySeed as { n: number; name: string }[];
  const me = itin.find((s) => s.n === stageN);
  if (!me) return null;
  const stripped = me.name.replace(/^SS\d+\s+/i, "").trim();
  const m = stripped.match(/^(.*)\s+(\d+)$/);
  if (!m || Number(m[2]) < 2) return null;
  const family = m[1].trim().toLowerCase();
  const pass = Number(m[2]);
  const prev = [...itin].reverse().find((s) => {
    const t = s.name.replace(/^SS\d+\s+/i, "").trim().match(/^(.*)\s+(\d+)$/);
    return t && t[1].trim().toLowerCase() === family && Number(t[2]) === pass - 1;
  });
  return prev?.n ?? null;
}

export async function runSimScript(name: string) {
  const st = await getSimState();
  const stageJump = name.match(/^ss(\d+)-(start|finish|cancel)$/i);
  if (stageJump) {
    const n = Number(stageJump[1]);
    const kind = stageJump[2].toLowerCase();
    const car = st.selectedCar;
    if (kind === "start") {
      return startStagePlayback(n);
    }
    if (kind === "finish") {
      return finishStagePlayback(n);
    }
    if (kind === "cancel") {
      const cancelled = Array.from(new Set([...(st.cancelled || []), n]));
      await setSimState({ cancelled, completed: Math.max(st.completed, n) });
      await logIrregularity({ severity: "info", source: "rs-packet", message: `SS${n} cancelled by owner` });
      return getSimState();
    }
    await setSimState({ completed: n, playing: false, selectedCar: car });
    await seedPrevSignal({ racingStatus: 1, stageNumber: n });
    await setCarPacket(car, { racingStatus: 0, stageNumber: n, speed: kind === "cancel" ? 0 : 26 });
    await logIrregularity({ severity: "info", source: "rs-packet", message: `SS${n} ${kind} car ${car}` });
    await fireSimTick();
    return getSimState();
  }
  switch (name) {
    case "cold":
      return hardRestart(true);
    case "ss1-start":
      return setSimState({ completed: 0, playing: false });
    case "ss1-finish":
      return finishStagePlayback(1);
    case "ss2-cancelled":
      return setSimState({ cancelled: Array.from(new Set([...(st.cancelled || []), 2])), completed: Math.max(st.completed, 2) });
    case "penalty": {
      const car = st.selectedCar || "1";
      return setSimState({ penalties: { ...st.penalties, [car]: (st.penalties[car] || 0) + 10 } });
    }
    case "dnf": {
      const car = st.selectedCar || "192";
      return setSimState({ retired: Array.from(new Set([...st.retired, car])) });
    }
    case "stopped": {
      const car = st.selectedCar || "1";
      return setSimState({ stopped: Array.from(new Set([...st.stopped, car])) });
    }
    case "moved": {
      const car = st.selectedCar || "1";
      return setSimState({ stopped: st.stopped.filter((c) => c !== car) });
    }
    case "stale": {
      const car = st.selectedCar || "1";
      return setSimState({ staleGps: Array.from(new Set([...st.staleGps, car])) });
    }
    case "service":
      return setSimState({ completed: Math.max(st.completed, 4) });
    case "final":
      return setSimState({ completed: 19, playing: false });
    case "reset":
    case "restart":
      return hardRestart(true);
    default:
      return st;
  }
}

export async function setCarPacket(car: string, patch: Partial<SimPacket>) {
  const st = await getSimState();
  const i = (entriesSeed as { number: string }[]).findIndex((e) => e.number === car);
  const prev = st.packets[car] ?? {
    racingStatus: 0,
    stageNumber: Math.max(1, st.completed),
    lat: 45.82 + Math.max(0, i) * 0.001,
    lng: -120.82 + Math.max(0, i) * 0.001,
    speed: 0,
    lastMessageTimestamp: new Date().toISOString(),
  };
  return setSimState({
    selectedCar: car,
    packets: { ...st.packets, [car]: { ...prev, stageTimeMs: 0, ...patch, lastMessageTimestamp: patch.lastMessageTimestamp ?? new Date().toISOString() } },
  });
}

export async function fireSimTick(car?: string) {
  const { getSubscribersForCar } = await import("@/lib/store");
  const { processWatchedEvent } = await import("@/lib/rally-poll");
  if (car) {
    const id = entryIdForCar(car);
    const subs = await getSubscribersForCar(TEST_EVENT_ID, id);
    if (!subs.length) return [];
    return processWatchedEvent(TEST_EVENT_ID, id);
  }
  return processWatchedEvent(TEST_EVENT_ID);
}

export async function seedPrevSignal(opts: {
  car?: string;
  racingStatus: number;
  stageNumber: number;
  stoppedAgoMs?: number;
  qualify?: number;
}) {
  const { setLiveState } = await import("@/lib/store");
  const st = await getSimState();
  const car = opts.car || st.selectedCar;
  const entryId = entryIdForCar(car);
  const pkt = st.packets[car];
  const i = (entriesSeed as { number: string }[]).findIndex((e) => e.number === car);
  await setLiveState({
    entryId,
    eventId: TEST_EVENT_ID,
    lat: pkt?.lat ?? 45.82 + Math.max(0, i) * 0.001,
    lng: pkt?.lng ?? -120.82 + Math.max(0, i) * 0.001,
    speed: pkt?.speed ?? 0,
    lastMessageTimestamp: new Date().toISOString(),
    stoppedSinceTs: opts.stoppedAgoMs ? Date.now() - opts.stoppedAgoMs : null,
    stopOriginLat: opts.stoppedAgoMs ? pkt?.lat ?? 45.82 : null,
    stopOriginLng: opts.stoppedAgoMs ? pkt?.lng ?? -120.82 : null,
    alertSentForThisStop: false,
    incidentQualifyCount: opts.qualify ?? 0,
    lastKnownStageNumber: opts.stageNumber,
    lastKnownRacingStatus: opts.racingStatus,
  });
}

export async function hardRestart(play: boolean) {
  const prev = await getSimState();
  const order = (entriesSeed as { number: string }[]).map((e) => e.number);
  const cars = buildCarTimelines({ fromStage: 1, toStage: 19, preTransit: true, retired: [], cancelled: [], order });
  const next: SimState = {
    ...DEFAULT,
    speed: prev.speed || 1,
    smsLive: prev.smsLive,
    selectedCar: prev.selectedCar || "1",
    selectedCars: prev.selectedCars?.length ? prev.selectedCars : [prev.selectedCar || "1"],
    playing: play,
    completed: 0,
    playback: { mode: "event", stage: 1, t0: Date.now(), cars, order, reseededNights: [], elapsedMs: 0, lastTickAt: Date.now() },
  };
  await replaceSimState(next);
  const { clearAlertClaims, clearLiveState, clearResultsSentState } = await import("@/lib/store");
  await clearAlertClaims(TEST_EVENT_ID);
  await clearLiveState(TEST_EVENT_ID);
  await clearResultsSentState(TEST_EVENT_ID);
  await logIrregularity({
    severity: "info",
    source: "rs-packet",
    message: play ? `Restart — ${cars.length} cars at MTC OUT` : `Reset — ${cars.length} cars parked at MTC OUT`,
  });
  return play ? advancePlayback() : getSimState();
}

export async function startEventPlayback() {
  return hardRestart(true);
}

export async function startStagePlayback(stage: number) {
  const st = await getSimState();
  if ((st.cancelled || []).includes(stage)) {
    await setSimState({ completed: stage, playing: false, playback: null });
    await logIrregularity({ severity: "info", source: "rs-packet", message: `SS${stage} cancelled — no start` });
    return getSimState();
  }
  const order = (entriesSeed as { number: string }[]).map((e) => e.number);
  // Build 1..stage so two-pass gates still apply (SS2 cannot start until the
  // whole field has finished SS1). Then jump elapsed to the first car's start
  // of THIS stage — pass-1 is already in the past on the timeline.
  const cars = buildCarTimelines({
    fromStage: 1,
    toStage: stage,
    preTransit: stage <= 1,
    retired: st.retired,
    cancelled: st.cancelled,
    order,
  });
  const firstStart = Math.min(
    ...cars.map((c) => c.segs.find((s) => s.kind === "stage" && s.stage === stage)?.startMs ?? Number.POSITIVE_INFINITY)
  );
  const elapsedMs = Number.isFinite(firstStart) ? firstStart : 0;
  await setSimState({
    completed: Math.max(0, stage - 1),
    playing: true,
    playback: { mode: "stage", stage, t0: Date.now(), cars, order, reseededNights: [], elapsedMs, lastTickAt: Date.now() },
  });
  await logIrregularity({
    severity: "info",
    source: "rs-packet",
    message: `SS${stage} field start — ${cars.length} cars, two-pass gated, 2-min ARA gaps`,
  });
  return advancePlayback();
}

/** Skip the rest of this stage: post every car's historic time, jump elapsed to
 * after the last car finishes, land the field in the following service/transit. */
export async function finishStagePlayback(stage: number) {
  const st = await getSimState();
  const order = st.playback?.order?.length
    ? st.playback.order
    : (entriesSeed as { number: string }[]).map((e) => e.number);
  const cars = buildCarTimelines({
    fromStage: 1,
    toStage: 19,
    preTransit: true,
    retired: st.retired,
    cancelled: st.cancelled,
    order,
  });
  for (const c of cars) {
    const seg = c.segs.find((s) => s.kind === "stage" && s.stage === stage);
    if (seg?.durationMs) await recordPostedTime(c.number, stage, seg.durationMs);
    c.firedFinishes = Array.from(new Set([...(c.firedFinishes || []), stage]));
    c.firedStarts = Array.from(new Set([...(c.firedStarts || []), stage]));
  }
  const leaveTimes = cars
    .map((c) => {
      const seg = c.segs.find((s) => s.kind === "stage" && s.stage === stage);
      return seg ? seg.startMs + seg.durationMs : 0;
    })
    .filter((t) => t > 0);
  const elapsedMs = leaveTimes.length ? Math.max(...leaveTimes) : 0;
  await setSimState({
    completed: Math.max(st.completed, stage),
    playing: true,
    playback: {
      mode: st.playback?.mode || "event",
      stage,
      t0: Date.now(),
      cars,
      order,
      reseededNights: st.playback?.reseededNights || [],
      elapsedMs,
      lastTickAt: Date.now(),
      frozenElapsed: undefined,
    },
  });
  await logIrregularity({
    severity: "info",
    source: "rs-packet",
    message: `SS${stage} skipped — ${cars.length} cars posted, field jumped to after-stage (service/transit)`,
  });
  return advancePlayback();
}

export async function catchUpPlayback() {
  const client = await getPool().connect();
  try {
    const got = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [20251925]);
    if (!got.rows[0]?.ok) return getSimState();
    try {
      const st0 = await getSimState();
      if (!st0.playing || !st0.playback) return st0;
      const speed = Math.max(0.25, st0.speed || 1);
      const base = st0.playback.elapsedMs ?? 0;
      const last = st0.playback.lastTickAt ?? st0.playback.t0;
      const target = base + Math.max(0, Date.now() - last) * speed;
      let guard = 0;
      while (guard++ < 90) {
        const st = await getSimState();
        if (!st.playing || !st.playback) break;
        const elapsed = st.playback.elapsedMs ?? 0;
        if (elapsed >= target - 1) break;
        const next = Math.min(target, elapsed + 1000 * speed);
        await setSimState({
          playback: { ...st.playback, elapsedMs: next, lastTickAt: Date.now() },
        });
        await advancePlaybackLocked(true);
      }
      await fireSimTick();
      return getSimState();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [20251925]);
    }
  } finally {
    client.release();
  }
}

export async function advancePlayback() {
  const client = await getPool().connect();
  try {
    const got = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [20251925]);
    if (!got.rows[0]?.ok) return getSimState();
    try {
      return await advancePlaybackLocked();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [20251925]);
    }
  } finally {
    client.release();
  }
}

async function advancePlaybackLocked(silent = false) {
  const st = await getSimState();
  if (!st.playing || !st.playback) return st;
  const elapsed = simElapsed(st);
  const pb = st.playback;
  const cars = pb.cars.map((c) => ({ ...c, segs: c.segs || [] }));
  let hotStage = pb.stage;
  let maxFinished = st.completed;
  let order = pb.order || cars.map((c) => c.number);
  let reseededNights = pb.reseededNights || [];

  const packets: Record<string, SimPacket> = { ...st.packets };
  const starts: string[] = [];
  const finishes: { car: string; stage: number; ms: number }[] = [];
  const ts = new Date().toISOString();

  for (const c of cars) {
    if (c.retired) continue;
    if (c.passBy) {
      const passer = cars.find((x) => x.number === c.passBy);
      const passerAt = passer ? segAt(passer, elapsed) : null;
      if (passerAt && passerAt.progress > (c.holdProgress || 0) + 0.01) {
        c.passBy = undefined;
        c.holdUntilElapsed = 0;
      }
    }
    const at = segAt(c, elapsed);
    const prevPkt = packets[c.number];
    const wasRacing = prevPkt?.racingStatus === 1;
    const prevStage = prevPkt?.stageNumber || 0;
    const i = (entriesSeed as { number: string }[]).findIndex((e) => e.number === c.number);
    const base: SimPacket = prevPkt ?? {
      racingStatus: 0,
      stageNumber: 1,
      lat: 45.82 + Math.max(0, i) * 0.001,
      lng: -120.82 + Math.max(0, i) * 0.001,
      speed: 0,
      lastMessageTimestamp: ts,
    };

    if (elapsed < c.holdUntilElapsed) {
      // Freeze the last packet — do not flip racingStatus. A 1→0 here was firing
      // finish alerts while the car was held (pass / two-pass queue) still on stage.
      packets[c.number] = { ...base, speed: 0, lastMessageTimestamp: ts };
      continue;
    }

    const prevSeg = c.cursor >= 0 ? c.segs[c.cursor] : null;
    const dest = at.waiting ? -1 : at.done ? c.segs.length - 1 : at.index;
    c.cursor = dest;

    if (prevSeg?.kind === "overnight" && at.seg && at.seg.kind !== "overnight" && !reseededNights.includes(prevSeg.stage)) {
      const alive = cars.filter((x) => !x.retired).map((x) => x.number);
      order = reseedOrder(alive, prevSeg.stage, st.cancelled || [], order, postedFor(st));
      const rebuilt = buildCarTimelines({
        fromStage: prevSeg.stage + 1,
        toStage: 19,
        preTransit: false,
        retired: cars.filter((x) => x.retired).map((x) => x.number),
        cancelled: st.cancelled,
        order,
      });
      for (const car of cars) {
        const nb = rebuilt.find((x) => x.number === car.number);
        if (!nb) continue;
        const past = car.segs.filter((_, i2) => i2 <= car.cursor);
        const place = Math.max(0, order.indexOf(car.number));
        const delta = elapsed + place * ARA_FIRST_START_MS - (nb.segs[0]?.startMs || 0);
        car.segs = [...past, ...nb.segs.map((s) => ({ ...s, startMs: s.startMs + delta }))];
      }
      reseededNights = [...reseededNights, prevSeg.stage];
    }

    // Sitting on the start line (progress 0) is NOT racing — that's the queue.
    // racingStatus 1 only once they actually leave the line.
    const onStage = at.seg?.kind === "stage" && at.progress > 0 && !at.done;
    if (onStage && at.seg) {
      hotStage = at.seg.stage;
      packets[c.number] = { ...base, racingStatus: 1, stageNumber: at.seg.stage, speed: 95, stageTimeMs: 0, lastMessageTimestamp: ts };
      const already = (c.firedStarts || []).includes(at.seg.stage);
      c.firedStarts = Array.from(new Set([...(c.firedStarts || []), at.seg.stage]));
      if (!wasRacing && !already) starts.push(c.number);
    } else {
      const leftStage = wasRacing && prevStage > 0 && !onStage;
      const stageSeg = c.segs.find((s) => s.kind === "stage" && s.stage === prevStage);
      const spd = at.seg?.kind === "service" || at.seg?.kind === "overnight" || at.seg?.kind === "regroup" ? 0 : 48;
      const finishMs = leftStage ? stageSeg?.durationMs || 0 : base.stageTimeMs || 0;
      packets[c.number] = {
        ...base,
        racingStatus: 0,
        stageNumber: at.seg?.stage || prevStage || 1,
        speed: spd,
        stageTimeMs: finishMs,
        lastMessageTimestamp: ts,
      };
      if (leftStage) {
        maxFinished = Math.max(maxFinished, prevStage);
        const alreadyF = (c.firedFinishes || []).includes(prevStage);
        c.firedFinishes = Array.from(new Set([...(c.firedFinishes || []), prevStage]));
        if (!alreadyF) finishes.push({ car: c.number, stage: prevStage, ms: stageSeg?.durationMs || 0 });
      }
    }
  }

  const allDone = cars.every((c) => {
    if (c.retired) return true;
    if (c.cursor < c.segs.length - 1) return false;
    return segAt(c, elapsed).done;
  });
  const latest = await getSimState();
  if (!latest.playing || !latest.playback || latest.playback.t0 !== pb.t0) {
    return latest;
  }
  const posted = { ...(st.postedTimes || {}) };
  for (const f of finishes) {
    if (!f.ms) continue;
    const k = String(f.stage);
    posted[k] = { ...(posted[k] || {}), [f.car]: Math.round(f.ms) };
    await recordPostedTime(f.car, f.stage, f.ms);
  }
  await setSimState({
    packets,
    playback: { ...pb, cars, stage: hotStage, order, reseededNights, elapsedMs: elapsed, lastTickAt: Date.now(), frozenElapsed: undefined },
    playing: !allDone,
    completed: allDone ? 19 : maxFinished,
    retired: cars.filter((c) => c.retired).map((c) => c.number),
    postedTimes: posted,
  });
  for (const n of starts) {
    if (silent) continue;
    await logIrregularity({ severity: "info", source: "rs-packet", message: `SS start #${n} racingStatus 0→1` });
    await fireSimTick(n);
  }
  for (const f of finishes) {
    if (silent) continue;
    await logIrregularity({ severity: "info", source: "rs-packet", message: `#${f.car} finished SS${f.stage}` });
    await fireSimTick(f.car);
  }
  // NOTE: previously also called fireSimTick() here with no car filter — that re-ran
  // processWatchedEvent for every watched car, including ones just handled by the
  // per-car calls above, causing stage-time/overall alerts to double-send. The
  // per-car ticks above already cover every start/finish this pass; no blanket
  // re-tick needed.
  return getSimState();
}

export async function applyIncident(kind: string, carNum: string) {
  const st = await getSimState();
  if (!st.playback) return st;
  const elapsed = simElapsed(st);
  const pb = st.playback;
  const cars = pb.cars.map((c) => ({ ...c, segs: c.segs || [] }));
  const car = cars.find((c) => c.number === carNum);
  if (!car || car.retired) return st;
  const at = segAt(car, elapsed);
  const k = kind.toLowerCase();

  if (k === "retire") {
    car.retired = true;
    car.holdProgress = at.progress;
    await setCarPacket(carNum, { racingStatus: 0, stageNumber: at.seg?.stage || st.completed || 1, speed: 0 });
    await logIrregularity({ severity: "warn", source: "rs-packet", message: `#${carNum} retired on ${at.seg?.label || "route"}` });
    await setSimState({ playback: { ...pb, cars }, retired: Array.from(new Set([...st.retired, carNum])) });
    return fireSimTick(carNum);
  }

  if (k === "puncture") {
    const wait = Math.round((90 + Math.random() * 30) * 1000);
    car.holdUntilElapsed = elapsed + wait;
    car.holdProgress = at.progress;
    car.delayMs += wait;
    await setCarPacket(carNum, { racingStatus: at.seg?.kind === "stage" ? 1 : 0, stageNumber: at.seg?.stage || 1, speed: 0 });
    await logIrregularity({ severity: "warn", source: "rs-packet", message: `#${carNum} puncture — stopped ${(wait / 1000).toFixed(0)}s then resumes` });
    await setSimState({ playback: { ...pb, cars }, stopped: Array.from(new Set([...st.stopped, carNum])) });
    return fireSimTick(carNum);
  }

  if (k === "pass") {
    const ahead = cars
      .filter((o) => o.number !== carNum && !o.retired)
      .map((o) => ({ o, at: segAt(o, elapsed) }))
      .filter((x) => x.at.seg && at.seg && x.at.seg.kind === at.seg.kind && x.at.seg.stage === at.seg.stage && x.at.seg.label === at.seg.label && x.at.progress > at.progress)
      .sort((a, b) => a.at.progress - b.at.progress)[0];
    if (!ahead) {
      await logIrregularity({ severity: "info", source: "rs-packet", message: `#${carNum} pass — no car ahead on this strip` });
      return st;
    }
    if (at.seg?.kind === "stage") {
      ahead.o.passBy = carNum;
      ahead.o.holdUntilElapsed = elapsed + 10 * 60 * 1000;
      ahead.o.holdProgress = ahead.at.progress;
      await setCarPacket(ahead.o.number, { racingStatus: 1, stageNumber: at.seg.stage, speed: 0 });
      await logIrregularity({
        severity: "info",
        source: "rs-packet",
        message: `#${carNum} push-to-pass on SS${at.seg.stage} — #${ahead.o.number} stopped until overtaken (RCR 5.17)`,
      });
    } else {
      ahead.o.holdUntilElapsed = elapsed + 15 * 1000;
      ahead.o.holdProgress = ahead.at.progress;
      const order = [...(pb.order || cars.map((c) => c.number))];
      const i = order.indexOf(carNum);
      const j = order.indexOf(ahead.o.number);
      if (i >= 0 && j >= 0) {
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
      }
      shiftFutureStarts(car, elapsed, -ARA_FIRST_START_MS);
      shiftFutureStarts(ahead.o, elapsed, ARA_FIRST_START_MS);
      pb.order = order;
      await logIrregularity({
        severity: "info",
        source: "rs-packet",
        message: `#${carNum} passed #${ahead.o.number} on ${at.seg?.label} — running order swapped for following stages`,
      });
    }
    await setSimState({ playback: { ...pb, cars, order: pb.order } });
    return fireSimTick(carNum);
  }

  return st;
}
export function simElapsed(st: { playing: boolean; speed: number; playback: Playback | null }): number {
  const pb = st.playback;
  if (!pb) return 0;
  if (!st.playing) return pb.frozenElapsed ?? pb.elapsedMs ?? 0;
  const speed = Math.max(0.25, st.speed || 1);
  const base = pb.elapsedMs ?? 0;
  const last = pb.lastTickAt ?? pb.t0;
  // Real wall clock × speed. Do not cap — a 1s cap made 1x run at ~0.5x whenever
  // ticks were slower than 1s, so a 3:30 historic stage took ~7 minutes on the graphic.
  const wall = Math.max(0, Date.now() - last);
  return base + wall * speed;
}

export async function panicStop() {
  const st = await getSimState();
  if (!st.playback) return st;
  const elapsed = simElapsed(st);
  await setSimState({
    playing: false,
    playback: { ...st.playback, frozenElapsed: elapsed },
  });
  const frozen = await getSimState();
  for (const c of frozen.playback?.cars || []) {
    if (c.retired) continue;
    const at = segAt(c, elapsed);
    await setCarPacket(c.number, { racingStatus: 0, stageNumber: at.seg?.stage || frozen.completed || 1, speed: 0 });
  }
  await logIrregularity({ severity: "warn", source: "rs-packet", message: "PANIC STOP — field frozen" });
  return getSimState();
}

export async function resumePlayback() {
  const st = await getSimState();
  if (!st.playback) return hardRestart(true);
  const elapsed = st.playback.frozenElapsed ?? st.playback.elapsedMs ?? 0;
  const speed = Math.max(0.25, st.speed || 1);
  await setSimState({
    playing: true,
    playback: {
      ...st.playback,
      elapsedMs: elapsed,
      lastTickAt: Date.now(),
      frozenElapsed: undefined,
      t0: Date.now() - elapsed / speed,
    },
  });
  await logIrregularity({ severity: "info", source: "rs-packet", message: "RESUME — field rolling from freeze" });
  return advancePlayback();
}

export async function skipOvernight() {
  const st = await getSimState();
  if (!st.playing || !st.playback) return st;
  const speed = Math.max(0.25, st.speed || 1);
  const elapsed = simElapsed(st);
  const skip = overnightSkip(st.playback, elapsed);
  if (!skip) return st;
  const t0 = Date.now() - skip.targetElapsedMs / speed;
  await setSimState({ playback: { ...st.playback, t0, elapsedMs: skip.targetElapsedMs, lastTickAt: Date.now(), frozenElapsed: undefined } });
  await logIrregularity({
    severity: "info",
    source: "rs-packet",
    message: `Skipped overnight to 30 min before first car out (${skip.label})`,
  });
  return advancePlayback();
}

export function trackSnapshot(st: SimState) {
  try {
    const speed = Math.max(0.25, st.speed || 1);
    const elapsed = simElapsed(st);
    return {
      playing: st.playing,
      speed,
      completed: st.completed,
      elapsedMs: elapsed,
      dots: dotsFromPlayback(st.playback, elapsed),
      overnight: overnightSkip(st.playback, elapsed),
    };
  } catch {
    return { playing: false, speed: st.speed || 1, completed: st.completed, elapsedMs: 0, dots: [] as ReturnType<typeof dotsFromPlayback>, overnight: null };
  }
}
export async function simInject(action: string, car?: string) {
  const st = await getSimState();
  const c = car || st.selectedCar;
  await setSimState({ selectedCar: c });
  const a = action.toLowerCase();
  const stage = Math.max(1, st.completed || 1);

  if (a.includes("started")) {
    await seedPrevSignal({ racingStatus: 0, stageNumber: stage });
    await setCarPacket(c, { racingStatus: 1, stageNumber: stage, speed: 82 });
    await logIrregularity({ severity: "info", source: "rs-packet", message: `car ${c} racingStatus 0→1 SS${stage}` });
    return fireSimTick(c);
  }
  if (a.includes("finished") || a.includes("posted") || a.includes("overall")) {
    await seedPrevSignal({ racingStatus: 1, stageNumber: stage });
    await setSimState({ completed: Math.min(19, Math.max(st.completed, stage)) });
    await setCarPacket(c, { racingStatus: 0, stageNumber: stage, speed: 28 });
    await logIrregularity({ severity: "info", source: "rs-packet", message: `car ${c} racingStatus 1→0 SS${stage}` });
    return fireSimTick(c);
  }
  if (a.includes("stopped-on-stage") || a === "stopped") {
    await setCarPacket(c, { racingStatus: 1, stageNumber: stage, speed: 0 });
    await seedPrevSignal({ racingStatus: 1, stageNumber: stage, stoppedAgoMs: 75_000, qualify: 3 });
    await setSimState({ stopped: Array.from(new Set([...st.stopped, c])) });
    await logIrregularity({ severity: "warn", source: "rs-packet", message: `car ${c} speed 0 on SS${stage} for 75s` });
    return fireSimTick(c);
  }
  if (a.includes("moved")) {
    const pkt = (await getSimState()).packets[c];
    await setCarPacket(c, { racingStatus: 1, stageNumber: stage, speed: 55, lat: (pkt?.lat ?? 45.82) + 0.0006, lng: (pkt?.lng ?? -120.82) + 0.0006 });
    await setSimState({ stopped: (await getSimState()).stopped.filter((x) => x !== c) });
    await logIrregularity({ severity: "info", source: "rs-packet", message: `car ${c} moved >40m and 55 km/h` });
    return fireSimTick(c);
  }
  if (a.includes("stale")) {
    await setCarPacket(c, { racingStatus: 1, stageNumber: stage, speed: 0, lastMessageTimestamp: new Date(Date.now() - 60_000).toISOString() });
    await setSimState({ staleGps: Array.from(new Set([...(await getSimState()).staleGps, c])) });
    await logIrregularity({ severity: "warn", source: "rs-packet", message: `car ${c} GPS age 60s` });
    return fireSimTick(c);
  }
  if (a.includes("penalty")) return runSimScript("penalty");
  if (a.includes("retired")) {
    await setCarPacket(c, { racingStatus: 0, speed: 0 });
    return runSimScript("dnf");
  }
  if (a.includes("sos")) {
    await setCarPacket(c, { racingStatus: 1, stageNumber: stage, speed: 0 });
    await seedPrevSignal({ racingStatus: 1, stageNumber: stage, stoppedAgoMs: 90_000, qualify: 4 });
    await setSimState({ sos: Array.from(new Set([...(await getSimState()).sos, c])) });
    await logIrregularity({ severity: "critical", source: "rs-packet", message: `car ${c} SOS / stopped 90s SS${stage}` });
    return fireSimTick(c);
  }
  if (a.includes("service")) return runSimScript("service");
  return getSimState();
}

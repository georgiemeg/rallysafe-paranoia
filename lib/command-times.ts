import { listEvents, getEntries, listStages, rsFetch } from "@/lib/rallysafe";
import { findCombinerEventByName, computeOverallStandings } from "@/lib/combiner";
import { computeRcOverallStandings, type OverallStanding } from "@/lib/rallysafe-rc-overall";
import { fieldDistance } from "@/lib/overall-rank";
import type { CarSubscription } from "@/lib/store";

const BAR = "==================================================";

function clock(ms: number): string {
  const abs = Math.abs(ms) / 1000;
  const m = Math.floor(abs / 60);
  const s = (abs % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

type FieldRow = {
  position: number;
  number: string;
  carClass: string;
  driverName: string;
  codriverName: string;
  timeMs: number;
  stagesCompleted?: number;
  stagesTotal?: number;
  gapToLeaderMs?: number;
  isRetired?: boolean;
  penaltySecondsNet?: number;
  isPenalized?: boolean;
};

function carLine(row: FieldRow, distance?: number, extra = ""): string {
  const names = row.codriverName ? `${row.driverName}/${row.codriverName}` : row.driverName;
  const total = row.stagesTotal ?? distance;
  const stages =
    total != null && row.stagesCompleted != null
      ? `, ${row.stagesCompleted} of ${total} stages`
      : "";
  const gap = row.gapToLeaderMs != null ? `, +${clock(row.gapToLeaderMs)} to leader` : "";
  const pen = row.isPenalized && row.penaltySecondsNet ? ` PEN ${row.penaltySecondsNet}s` : "";
  return `P${row.position} #${row.number} ${row.carClass} (${names}): ${clock(row.timeMs)}${stages}${gap}${pen}${extra}`;
}

function packAround(field: FieldRow[], carNumber: string, distance?: number): string | null {
  const idx = field.findIndex((r) => String(r.number) === String(carNumber));
  if (idx < 0) return null;
  const me = field[idx];
  const ahead = field.slice(Math.max(0, idx - 3), idx);
  const behind = field.slice(idx + 1, idx + 4);
  const lines: string[] = [];
  for (const r of ahead) lines.push(carLine(r, distance));
  lines.push(`>>> ${carLine(me, distance)} <<<`);
  for (const r of behind) lines.push(carLine(r, distance));
  return lines.join("\n");
}

function joinBlocks(blocks: string[]): string {
  return `${BAR}\n${blocks.join(`\n${BAR}\n\n${BAR}\n`)}\n${BAR}`;
}

function toField(standings: OverallStanding[], classOnly?: string): FieldRow[] {
  const distance = fieldDistance(standings);
  let rows = standings.filter((r) => !r.isRetired && r.stagesCompleted === distance);
  if (classOnly) rows = rows.filter((r) => r.carClass === classOnly);
  rows = [...rows].sort((a, b) => a.totalMs - b.totalMs);
  return rows.map((r, i) => ({
    position: i + 1,
    number: String(r.number),
    carClass: r.carClass,
    driverName: r.driverName,
    codriverName: r.codriverName,
    timeMs: r.totalMs,
    stagesCompleted: r.stagesCompleted,
    stagesTotal: r.stagesTotal,
    gapToLeaderMs: r.totalMs - (rows[0]?.totalMs ?? r.totalMs),
    isRetired: r.isRetired,
    penaltySecondsNet: r.penaltySecondsNet,
    isPenalized: r.isPenalized,
  }));
}

async function loadStandings(eventId: number, eventName: string): Promise<OverallStanding[] | null> {
  if (eventId === 20251925) {
    const { simOverall } = await import("@/lib/sim/engine");
    const data = await simOverall();
    return data.standings as OverallStanding[];
  }
  const namesToTry = [eventName].filter(Boolean);
  for (const name of namesToTry) {
    try {
      const data = await findCombinerEventByName(name);
      if (!data) continue;
      const standings = await computeOverallStandings(data);
      if (standings.length > 0) return standings;
    } catch (err) {
      console.error("live overall for commands failed", name, err);
    }
  }
  try {
    const [entries, stages] = await Promise.all([getEntries(eventId), listStages(eventId)]);
    const byId = new Map<string, { carClass: string; carModel: string }>();
    for (const e of entries) {
      byId.set(e.identifier, { carClass: e.classText ?? "", carModel: e.vehicle?.make ?? "" });
    }
    const { standings } = await computeRcOverallStandings(stages, byId);
    if (standings.length > 0) return standings;
  } catch (err) {
    console.error("rc overall for commands failed", err);
  }
  return null;
}

type StageField = { name: string; rows: FieldRow[] };

async function loadLatestStageField(eventId: number, eventName: string): Promise<StageField | null> {
  if (eventId === 20251925) {
    const { getSimState } = await import("@/lib/sim/engine");
    const itinerary = (await import("@/lib/sim/seed/itinerary.json")).default as { n: number; name: string }[];
    const entries = (await import("@/lib/sim/seed/entries.json")).default as { number: string; driver: string; navigator: string; carClass: string }[];
    const st = await getSimState();
    const posted = (st.postedTimes || {}) as Record<string, Record<string, number>>;
    const stages = Object.keys(posted)
      .map(Number)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const n = stages[stages.length - 1];
    if (!n) return null;
    const byCar = posted[String(n)] || {};
    const parsed: FieldRow[] = [];
    for (const e of entries) {
      const ms = byCar[e.number];
      if (!ms) continue;
      parsed.push({
        position: 0,
        number: e.number,
        carClass: e.carClass,
        driverName: e.driver,
        codriverName: e.navigator,
        timeMs: ms,
      });
    }
    parsed.sort((a, b) => a.timeMs - b.timeMs);
    parsed.forEach((r, i) => {
      r.position = i + 1;
    });
    if (!parsed.length) return null;
    return { name: itinerary.find((s) => s.n === n)?.name || `SS${n}`, rows: parsed };
  }
  const namesToTry = [eventName].filter(Boolean);
  for (const name of namesToTry) {
    try {
      const data = await findCombinerEventByName(name);
      if (!data) continue;
      const idx = [...data.stages]
        .map((s, i) => ({ s, i }))
        .reverse()
        .find(({ s }) => /^(completed|hot|live)$/i.test(s.status || ""))?.i;
      if (idx == null) continue;
      const parsed: FieldRow[] = [];
      for (const e of data.entries) {
        const t = e.times?.[idx];
        if (!t) continue;
        const parts = t.split(":");
        let ms: number | null = null;
        if (parts.length === 2) ms = (Number(parts[0]) * 60 + Number(parts[1])) * 1000;
        else if (parts.length === 1 && t.trim()) ms = Number(t) * 1000;
        if (ms == null || !Number.isFinite(ms)) continue;
        parsed.push({
          position: 0,
          number: String(e.number),
          carClass: e.carClass,
          driverName: "",
          codriverName: "",
          timeMs: ms,
        });
      }
      parsed.sort((a, b) => a.timeMs - b.timeMs);
      parsed.forEach((r, i) => {
        r.position = i + 1;
      });
      try {
        const standings = await computeOverallStandings(data);
        const byNum = new Map(standings.map((s) => [String(s.number), s]));
        for (const r of parsed) {
          const s = byNum.get(r.number);
          if (!s) continue;
          r.driverName = s.driverName;
          r.codriverName = s.codriverName;
          if (!r.carClass) r.carClass = s.carClass;
        }
      } catch {
        /* names optional */
      }
      if (parsed.length) return { name: data.stages[idx].name, rows: parsed };
    } catch (err) {
      console.error("combiner stage field failed", err);
    }
  }
  try {
    const stages = await listStages(eventId);
    const done = stages
      .filter((s) => !s.isTransit && (s.status === 4 || s.status === 3))
      .sort((a, b) => a.number - b.number);
    const last = done[done.length - 1];
    if (!last) return null;
    const times = await rsFetch<
      {
        identifier: string;
        stageTime: number;
        driver?: { firstName: string; surname: string };
        navigator?: { firstName: string; surname: string } | null;
      }[]
    >(`/times/stage-times?stageId=${last.locationGroupId}`);
    const entries = await getEntries(eventId);
    const classBy = new Map(entries.map((e) => [e.identifier, e.classText ?? ""]));
    const rows: FieldRow[] = times
      .filter((t) => /^\d+$/.test(String(t.identifier)) && t.stageTime > 0)
      .map((t) => ({
        position: 0,
        number: String(t.identifier),
        carClass: classBy.get(String(t.identifier)) ?? "",
        driverName: t.driver ? `${t.driver.firstName} ${t.driver.surname}`.trim() : "",
        codriverName: t.navigator ? `${t.navigator.firstName} ${t.navigator.surname}`.trim() : "",
        timeMs: t.stageTime,
      }))
      .sort((a, b) => a.timeMs - b.timeMs);
    rows.forEach((r, i) => {
      r.position = i + 1;
    });
    if (!rows.length) return null;
    return { name: last.name, rows };
  } catch (err) {
    console.error("rc stage field failed", err);
    return null;
  }
}

function groupSubs(subs: CarSubscription[]) {
  const byEvent = new Map<number, CarSubscription[]>();
  for (const s of subs) {
    const list = byEvent.get(s.eventId) ?? [];
    list.push(s);
    byEvent.set(s.eventId, list);
  }
  return byEvent;
}

export async function overallTimeCheck(subs: CarSubscription[]): Promise<string> {
  let events: { eventId: number; name: string }[] = [];
  try {
    events = await listEvents({ take: 80 });
  } catch (err) {
    console.error("listEvents for overall check failed", err);
  }
  const blocks: string[] = [];
  for (const [eventId, cars] of groupSubs(subs)) {
    const name = events.find((e) => e.eventId === eventId)?.name ?? "";
    const standings = await loadStandings(eventId, name);
    if (!standings || standings.length === 0) continue;
    const distance = fieldDistance(standings);
    for (const car of cars) {
      const field = toField(standings, car.classScopeOnly ? car.carClass : undefined);
      const packed = packAround(field, car.carNumber, distance);
      if (packed) {
        blocks.push(car.classScopeOnly ? `${packed} (class only)` : packed);
        continue;
      }
      const row = standings.find((r) => String(r.number) === String(car.carNumber));
      if (!row) {
        blocks.push(`Car #${car.carNumber} (${car.driverName}): no time yet / not listed.`);
      } else {
        const pen = row.isPenalized && row.penaltySecondsNet ? ` PEN ${row.penaltySecondsNet}s` : "";
        blocks.push(
          `Car #${car.carNumber} ${car.carClass} (${car.driverName}/${car.codriverName}): not classified (${row.stagesCompleted} of ${row.stagesTotal ?? distance} stages).${pen}${row.isRetired ? " RETIRED" : ""}`
        );
      }
    }
  }
  if (!blocks.length) return "No completed stages yet to report on.";
  return joinBlocks(blocks);
}

export async function stageTimeCheck(subs: CarSubscription[]): Promise<string> {
  let events: { eventId: number; name: string }[] = [];
  try {
    events = await listEvents({ take: 80 });
  } catch (err) {
    console.error("listEvents for stage check failed", err);
  }
  const blocks: string[] = [];
  for (const [eventId, cars] of groupSubs(subs)) {
    const name = events.find((e) => e.eventId === eventId)?.name ?? "";
    const stage = await loadLatestStageField(eventId, name);
    if (!stage) continue;
    for (const car of cars) {
      let field = stage.rows;
      if (car.classScopeOnly) {
        field = field.filter((r) => r.carClass === car.carClass).map((r, i) => ({ ...r, position: i + 1 }));
      }
      const packed = packAround(field, car.carNumber);
      if (packed) {
        blocks.push(`${stage.name}\n${packed}${car.classScopeOnly ? " (class only)" : ""}`);
      } else {
        blocks.push(`${stage.name}\nCar #${car.carNumber} (${car.driverName}): no time on this stage yet.`);
      }
    }
  }
  if (!blocks.length) return "No completed stages yet to report on.";
  return joinBlocks(blocks);
}

export async function serviceCheck(subs: CarSubscription[]): Promise<string> {
  const { simUpcomingServiceEstimatesFor } = await import("@/lib/sim/engine");
  const { serviceEstimatesMessage } = await import("@/lib/messages");
  const blocks: string[] = [];
  for (const car of subs) {
    if (car.eventId !== 20251925) {
      blocks.push(`Car #${car.carNumber}: service estimates are only available for the RallySafe Paranoia test event right now.`);
      continue;
    }
    const stage = await loadLatestStageField(car.eventId, "");
    const completedStage = stage
      ? (await import("@/lib/sim/seed/itinerary.json")).default.find((s: { name: string }) => s.name === stage.name)?.n ?? 0
      : 0;
    const estimates = simUpcomingServiceEstimatesFor(car.carNumber, completedStage);
    if (!estimates.length) {
      blocks.push(`Car #${car.carNumber} (${car.driverName}): no more service stops scheduled.`);
      continue;
    }
    blocks.push(serviceEstimatesMessage(car, estimates));
  }
  if (!blocks.length) return "No cars to report on.";
  return joinBlocks(blocks);
}

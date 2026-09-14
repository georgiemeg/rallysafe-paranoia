import { ewrcGet } from "@/lib/ewrc";

export type RecentEvent = {
  key: string;
  name: string;
  rallysafeId: number | null;
  ewrcId: number | null;
  from: string;
  until: string;
  done: boolean;
  flag: string;
};

type CalEvent = {
  id: number;
  name: string;
  from?: string;
  until?: string;
  cancelled?: number;
  flag?: string;
};

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function listEwrcEventsLastTwoWeeks(): Promise<RecentEvent[]> {
  const today = new Date();
  const lo = new Date(today);
  lo.setDate(lo.getDate() - 14);
  const loS = isoDay(lo);
  const hiS = isoDay(today);
  const year = today.getUTCFullYear();
  const cal = (await ewrcGet(`/calendar/${year}/list`)) as { events?: CalEvent[] }[] | null;
  if (!Array.isArray(cal)) return [];
  const seen = new Set<number>();
  const out: RecentEvent[] = [];
  for (const week of cal) {
    for (const e of week.events ?? []) {
      if (!e?.id || seen.has(e.id) || e.cancelled) continue;
      if (!e.name || /^to be used$/i.test(e.name)) continue;
      const from = (e.from ?? "").slice(0, 10);
      const until = (e.until ?? e.from ?? "").slice(0, 10);
      if (!from) continue;
      if (until < loS || from > hiS) continue;
      seen.add(e.id);
      out.push({
        key: `ewrc:${e.id}`,
        name: e.name,
        rallysafeId: null,
        ewrcId: e.id,
        from,
        until,
        done: until < hiS,
        flag: e.flag ?? "",
      });
    }
  }
  out.sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : a.name.localeCompare(b.name)));
  return out;
}

type FinalRow = {
  id: number;
  start_number: number;
  result?: number | string;
  superally?: number;
  time?: { raw?: number; pretty?: string };
  driver?: { id?: number; firstname?: string; lastname?: string };
  codriver?: { id?: number; firstname?: string; lastname?: string };
  car?: { name?: string };
  classes?: { name?: string }[];
};

export type EwrcStanding = {
  position: number;
  number: number;
  carClass: string;
  carModel: string;
  driverName: string;
  codriverName: string;
  stagesCompleted: number;
  stagesTotal: number;
  totalMs: number;
  gapToLeaderMs: number;
  gapToAheadMs: number;
  isRetired: boolean;
  isPenalized: boolean;
  penaltySecondsNet: number;
  ewrcDriverId: number | null;
  ewrcCodriverId: number | null;
  ewrcEntryId: number;
};

export async function getEwrcFinalStandings(eventId: number): Promise<{
  title: string;
  stages: { name: string; status: string; length: number }[];
  standings: EwrcStanding[];
  serviceIn: [];
  timeZone: string;
  source: "ewrc";
} | null> {
  const [eventRaw, finalsRaw, retiredRaw] = await Promise.all([
    ewrcGet(`/event/${eventId}`),
    ewrcGet(`/event/${eventId}/final-results`),
    ewrcGet(`/event/${eventId}/retirement`),
  ]);
  const event = (eventRaw && typeof eventRaw === "object" ? eventRaw : {}) as {
    name?: string;
    timezone?: string;
    starters?: number;
    finishers?: number;
  };
  const finals = (finalsRaw && typeof finalsRaw === "object" ? finalsRaw : {}) as { results?: FinalRow[] };
  const rows = finals.results ?? [];
  if (!rows.length) return null;

  const classified = rows.filter((r) => typeof r.result === "number" && r.time?.raw);
  classified.sort((a, b) => Number(a.result) - Number(b.result));
  const inFinals = new Set(classified.map((r) => r.start_number));
  const fromFinalsRetired = rows.filter((r) => typeof r.result !== "number" || !r.time?.raw);
  const fromApi = Array.isArray(retiredRaw) ? retiredRaw : [];

  const standings: EwrcStanding[] = [];
  let prevMs = 0;
  let leaderMs = 0;
  for (const r of classified) {
    const totalMs = Number(r.time?.raw) || 0;
    if (!leaderMs) leaderMs = totalMs;
    standings.push({
      position: Number(r.result) || standings.length + 1,
      number: r.start_number,
      carClass: r.classes?.[0]?.name || "",
      carModel: r.car?.name || "",
      driverName: `${r.driver?.firstname ?? ""} ${r.driver?.lastname ?? ""}`.trim(),
      codriverName: `${r.codriver?.firstname ?? ""} ${r.codriver?.lastname ?? ""}`.trim(),
      stagesCompleted: 0,
      stagesTotal: 0,
      totalMs,
      gapToLeaderMs: totalMs - leaderMs,
      gapToAheadMs: prevMs ? totalMs - prevMs : 0,
      isRetired: false,
      isPenalized: false,
      penaltySecondsNet: 0,
      ewrcDriverId: r.driver?.id ?? null,
      ewrcCodriverId: r.codriver?.id ?? null,
      ewrcEntryId: r.id,
    });
    prevMs = totalMs;
  }
  for (const r of fromFinalsRetired) {
    standings.push({
      position: standings.length + 1,
      number: r.start_number,
      carClass: r.classes?.[0]?.name || "",
      carModel: r.car?.name || "",
      driverName: `${r.driver?.firstname ?? ""} ${r.driver?.lastname ?? ""}`.trim(),
      codriverName: `${r.codriver?.firstname ?? ""} ${r.codriver?.lastname ?? ""}`.trim(),
      stagesCompleted: 0,
      stagesTotal: 0,
      totalMs: 0,
      gapToLeaderMs: 0,
      gapToAheadMs: 0,
      isRetired: true,
      isPenalized: false,
      penaltySecondsNet: 0,
      ewrcDriverId: r.driver?.id ?? null,
      ewrcCodriverId: r.codriver?.id ?? null,
      ewrcEntryId: r.id,
    });
    inFinals.add(r.start_number);
  }
  for (const r of fromApi as {
    id?: number;
    start_number?: number;
    driver?: { id?: number; firstname?: string; lastname?: string };
    codriver?: { id?: number; firstname?: string; lastname?: string };
    car?: { name?: string };
    classes?: { name?: string }[];
  }[]) {
    const num = r.start_number;
    if (!num || inFinals.has(num)) continue;
    standings.push({
      position: standings.length + 1,
      number: num,
      carClass: r.classes?.[0]?.name || "",
      carModel: r.car?.name || "",
      driverName: `${r.driver?.firstname ?? ""} ${r.driver?.lastname ?? ""}`.trim(),
      codriverName: `${r.codriver?.firstname ?? ""} ${r.codriver?.lastname ?? ""}`.trim(),
      stagesCompleted: 0,
      stagesTotal: 0,
      totalMs: 0,
      gapToLeaderMs: 0,
      gapToAheadMs: 0,
      isRetired: true,
      isPenalized: false,
      penaltySecondsNet: 0,
      ewrcDriverId: r.driver?.id ?? null,
      ewrcCodriverId: r.codriver?.id ?? null,
      ewrcEntryId: r.id ?? 0,
    });
  }

  return {
    title: event.name || "eWRC",
    stages: [],
    standings,
    serviceIn: [],
    timeZone: event.timezone || "",
    source: "ewrc",
  };
}

export type StageTimeRow = {
  stageNumber: number;
  name: string;
  cancelled: boolean;
  time: string;
  overall: string | null;
  pos: number | null;
};

export async function getEwrcEntryStages(eventId: number, entryId: number): Promise<{
  car: number;
  driver: string;
  stages: StageTimeRow[];
} | null> {
  const raw = await ewrcGet(`/entry/${eventId}/${entryId}`);
  if (!raw || typeof raw !== "object") return null;
  const d = raw as {
    entry?: {
      start_number?: number;
      driver?: { firstname?: string; lastname?: string };
    };
    stage_times?: {
      stage_number?: number;
      name?: string;
      cancelled?: number;
      times?: { stage_time?: { pretty?: string }; total_sum?: { pretty?: string }; retired?: number };
      stage_result_oa?: number;
    }[];
  };
  const stages: StageTimeRow[] = (d.stage_times ?? []).map((s) => ({
    stageNumber: s.stage_number ?? 0,
    name: s.name ?? "",
    cancelled: Boolean(s.cancelled),
    time: s.cancelled ? "CAN" : s.times?.retired ? "DNF" : s.times?.stage_time?.pretty || "—",
    overall: s.times?.total_sum?.pretty ?? null,
    pos: typeof s.stage_result_oa === "number" ? s.stage_result_oa : null,
  }));
  return {
    car: d.entry?.start_number ?? 0,
    driver: `${d.entry?.driver?.firstname ?? ""} ${d.entry?.driver?.lastname ?? ""}`.trim(),
    stages,
  };
}

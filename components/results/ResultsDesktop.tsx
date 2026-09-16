"use client";

import { useEffect, useState } from "react";
import { StandingsBoard } from "@/components/results/StandingsBoard";
import { isTestEventId } from "@/lib/sim/ids";

interface RSEvent {
  key: string;
  eventId: number;
  name: string;
  source: "ewrc" | "rallysafe";
  ewrcId: number | null;
  rallysafeId: number | null;
  done: boolean;
  from?: string;
  until?: string;
}

interface OverallStanding {
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
  penaltySecondsNet: number;
  board?: "national" | "regional";
  ewrcDriverId?: number | null;
  ewrcCodriverId?: number | null;
  ewrcEntryId?: number;
  team?: string;
  tyre?: string;
  averageSpeed?: number | null;
  retiredReason?: string | null;
  hasIncompleteData?: boolean;
}

interface ServiceEntry {
  serviceNumber: number;
  number: number;
  due: string;
}

interface OverallResponse {
  title: string;
  stages: { name: string; status: string; length: number; cancelled?: boolean; fullyCancelled?: boolean }[];
  standings: OverallStanding[];
  serviceIn: ServiceEntry[];
  timeZone: string;
  stagesCompleted?: number;
  latestStage?: { stage: number; name: string; rows: OverallStanding[] };
  surface?: string;
  totalDistanceKm?: number;
  starters?: number;
  finishers?: number;
  mapUrl?: string | null;
  serviceWindows?: { name: string; time: string; type: string; beforeStageNumber: number }[];
  retirements?: { carNumber: number; driverName: string; codriverName: string; stageNumber: number | null; reason: string }[];
  penalties?: { carNumber: number; driverName: string; stageNumber: number | null; penaltyPretty: string; reason: string }[];
  derivedServiceTimes?: { carNumber: number; serviceName: string; inTime: string; outTime: string; basis: string }[];
  source?: "ewrc" | "combiner" | "fallback";
  hasAnyIncompleteData?: boolean;
}

function msToClock(ms: number): string {
  const sign = ms < 0 ? "-" : "+";
  const abs = Math.abs(ms) / 1000;
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}` : `${m}:${s.toFixed(1).padStart(4, "0")}`;
  return body;
}

function gapLabel(ms: number): string {
  if (ms === 0) return "—";
  return `+${msToClock(ms)}`;
}

/** The combiner feed's ISO timestamps are mislabeled UTC ("Z") but the numbers are already
 * the event's local time (e.g. "13:35:00.000Z" really means 1:35 PM rally-local, GMT-05:00
 * in this case) — confirmed by cross-checking against the site's own displayed times. Do NOT
 * run these through `new Date().toLocaleTimeString()`, which would wrongly convert them to the
 * viewer's timezone. Parse the raw digits instead. */
function formatLocalIsoAsIs(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const [, year, month, day, hour, minute] = m;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  const h = Number(hour);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${weekday} ${h12}:${minute} ${ampm}`;
}

/** Service stops don't publish a departure time in the combiner feed — only the predicted
 * arrival. ARA service is 60 minutes (per the Overmountain supplementary regs: "Service A
 * (Newport Speedway) 60"), so Out = In + 60. */
const SERVICE_OUT_MINS = 60;

/** Add minutes to a combiner local-wall-time ISO string (mislabeled "Z") so the "out" time
 * can be shown next to the "in" time. */
function addMinutesToLocalIso(iso: string, minutes: number): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const [, y, mo, d, h, mi] = m.map(Number);
  const total = h * 60 + mi + minutes;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}T${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}:00`;
}

export function ResultsDesktop() {
  const [events, setEvents] = useState<RSEvent[]>([]);
  const [selected, setSelected] = useState<RSEvent | null>(null);
  const [araEventIds, setAraEventIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"overall" | "stagetimes">("overall");

  // Overall standings state
  const [overall, setOverall] = useState<OverallResponse | null>(null);
  const [overallLoading, setOverallLoading] = useState(false);
  const [overallError, setOverallError] = useState("");

  // Iframe (stage times / split times) state
  const [resultsEventId, setResultsEventId] = useState<number | null>(null);
  const [resolving, setResolving] = useState(false);
  const [iframeError, setIframeError] = useState("");

  const [serviceCarNumber, setServiceCarNumber] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);
  const [showAraOnlyToast, setShowAraOnlyToast] = useState(false);
  const [stageA, setStageA] = useState<{ car: number; driver: string; stages: { stageNumber: number; name: string; cancelled: boolean; time: string; overall: string | null; pos: number | null }[] } | null>(null);
  const [stageB, setStageB] = useState<{ car: number; driver: string; stages: { stageNumber: number; name: string; cancelled: boolean; time: string; overall: string | null; pos: number | null }[] } | null>(null);

  useEffect(() => {
    fetch("/api/events/active")
      .then((r) => r.json())
      .then((d) => {
        const list: RSEvent[] = (d.events ?? []).map((ev: RSEvent & { eventId: number; name: string }) => ({
          key: ev.key ?? `rs:${ev.eventId}`,
          eventId: ev.eventId,
          name: ev.name,
          source: ev.source ?? "rallysafe",
          ewrcId: ev.ewrcId ?? null,
          rallysafeId: ev.rallysafeId ?? ev.eventId,
          done: Boolean(ev.done),
          from: ev.from,
          until: ev.until,
        }));
        setEvents(list);
        setAraEventIds(new Set<number>(d.araEventIds ?? []));
        const active = list.find((ev) => ev.key === d.activeKey) ?? list[0] ?? null;
        setSelected(active);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const isAraEvent = selected?.rallysafeId ? araEventIds.has(selected.rallysafeId) : false;
  const useEwrc = Boolean(selected?.ewrcId && selected.done);

  const loadStages = (car: number, which: "a" | "b") => {
    if (!selected || !overall) return;
    const row = overall.standings.find((s) => s.number === car);
    if (useEwrc) {
      if (!row?.ewrcEntryId) {
        if (which === "a") setStageA(null);
        else setStageB(null);
        return;
      }
      fetch(`/api/results/ewrc-full/stages?eventId=${selected.ewrcId}&entryId=${row.ewrcEntryId}`)
        .then((r) => r.json())
        .then((d) => {
          if (!d.stages) return;
          const pack = {
            car: d.carNumber,
            driver: d.driverName,
            stages: d.stages.map((s: { stageNumber: number; name: string; cancelled: boolean; timeMs: number | null; runningTotalMs: number | null; positionAfterStage: number | null }) => ({
              stageNumber: s.stageNumber,
              name: s.name,
              cancelled: s.cancelled,
              time: s.timeMs != null ? msToClock(s.timeMs) : s.cancelled ? "CAN" : "—",
              overall: s.runningTotalMs != null ? msToClock(s.runningTotalMs) : null,
              pos: s.positionAfterStage,
            })),
          };
          if (which === "a") setStageA(pack);
          else setStageB(pack);
        })
        .catch(() => {});
      return;
    }
    // Live/fallback RallySafe path — same per-car breakdown UI, sourced from the raw feed.
    const eventId = selected.rallysafeId ?? selected.eventId;
    fetch(`/api/events/${eventId}/rc-stages?car=${car}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.stages) return;
        const pack = {
          car: d.carNumber,
          driver: d.driverName,
          stages: d.stages.map((s: { stageNumber: number; name: string; timeMs: number | null; penaltyMs: number }) => ({
            stageNumber: s.stageNumber,
            name: s.name,
            cancelled: false,
            time: s.timeMs != null ? msToClock(s.timeMs) : "—",
            overall: null,
            pos: null,
          })),
        };
        if (which === "a") setStageA(pack);
        else setStageB(pack);
      })
      .catch(() => {});
  };

  const handleRowClick = (carNumber: number) => {
    setServiceCarNumber(carNumber === serviceCarNumber ? null : carNumber);
    if (carNumber === serviceCarNumber) {
      setStageA(null);
      return;
    }
    loadStages(carNumber, "a");
  };

  const handleRowContext = (carNumber: number) => {
    setCompareB(carNumber === compareB ? null : carNumber);
    if (carNumber === compareB) {
      setStageB(null);
      return;
    }
    loadStages(carNumber, "b");
  };

  const handleRowDouble = (row: { ewrcDriverId?: number | null; driverName: string }) => {
    const id = row.ewrcDriverId;
    if (!id) return;
    window.open(`/people?kind=driver&ewrcId=${id}&name=${encodeURIComponent(row.driverName)}`, "_blank");
  };

  // Poll overall standings every 20s while that view is active. For ARA events, use the
  // combiner feed (has predicted service times for the Service Estimates alert). For any
  // other event, fall back to the universal endpoint built on RallySafe's official public
  // results API, which works for any event with a results page — just without service times.
  useEffect(() => {
    if (!selected || view !== "overall") return;
    let cancelled = false;

    const load = () => {
      setOverallLoading(true);
      setOverallError("");
      const test = isTestEventId(selected.rallysafeId ?? selected.eventId);
      const rsId = selected.rallysafeId ?? selected.eventId;
      const applyLive = (d: { standings?: unknown; error?: string; [k: string]: unknown }) => {
        if (d.standings) setOverall({ title: selected.name, ...d } as OverallResponse);
        else setOverallError(d.error ?? "No overall standings available yet.");
      };
      const url = test
        ? `/api/events/20251925/overall-official`
        : useEwrc
          ? `/api/results/ewrc-full?eventId=${selected.ewrcId}`
          : `/api/results/overall?eventName=${encodeURIComponent(selected.name)}`;
      fetch(url, { credentials: "include" })
        .then((r) => r.json())
        .then(async (d) => {
          if (cancelled) return;
          if (useEwrc && d.standings) {
            // Normalize the richer ewrc-full shape into OverallResponse.
            const standings: OverallStanding[] = d.standings.map((r: {
              position: number; number: number; carClass: string; carModel: string;
              driverName: string; codriverName: string; totalMs: number; gapToLeaderMs: number;
              gapToAheadMs: number; isRetired: boolean; retiredReason: string | null;
              penaltyMsTotal: number; entryId: number; ewrcDriverId: number | null;
              ewrcCodriverId: number | null; team: string; tyre: string; averageSpeed: number | null;
            }) => ({
              position: r.position,
              number: r.number,
              carClass: r.carClass,
              carModel: r.carModel,
              driverName: r.driverName,
              codriverName: r.codriverName,
              stagesCompleted: d.stages?.filter((s: { fullyCancelled?: boolean }) => !s.fullyCancelled).length ?? 0,
              stagesTotal: d.stages?.length ?? 0,
              totalMs: r.totalMs,
              gapToLeaderMs: r.gapToLeaderMs,
              gapToAheadMs: r.gapToAheadMs,
              isRetired: r.isRetired,
              isPenalized: r.penaltyMsTotal > 0,
              penaltySecondsNet: Math.round(r.penaltyMsTotal / 1000),
              ewrcDriverId: r.ewrcDriverId,
              ewrcCodriverId: r.ewrcCodriverId,
              ewrcEntryId: r.entryId,
              team: r.team,
              tyre: r.tyre,
              averageSpeed: r.averageSpeed,
              retiredReason: r.retiredReason,
            }));
            setOverall({
              title: d.title,
              stages: (d.stages ?? []).map((s: { name: string; cancelled: boolean; fullyCancelled: boolean; distanceKm: number }) => ({
                name: s.name,
                status: s.fullyCancelled ? "Cancelled" : "Completed",
                length: s.distanceKm,
                cancelled: s.cancelled,
                fullyCancelled: s.fullyCancelled,
              })),
              standings,
              serviceIn: [],
              timeZone: d.timeZone,
              stagesCompleted: (d.stages ?? []).filter((s: { fullyCancelled?: boolean }) => !s.fullyCancelled).length,
              surface: d.surface,
              totalDistanceKm: d.totalDistanceKm,
              starters: d.starters,
              finishers: d.finishers,
              mapUrl: d.mapUrl,
              serviceWindows: d.serviceWindows,
              retirements: d.retirements,
              penalties: d.penalties,
              derivedServiceTimes: d.derivedServiceTimes,
            });
          } else if (!useEwrc && !test && d.standings?.length) {
            applyLive(d);
          } else if (!useEwrc && !test) {
            const fb = await fetch(`/api/events/${rsId}/overall-official`, { credentials: "include" }).then((r) => r.json());
            if (cancelled) return;
            applyLive(fb);
          } else if (d.standings) {
            applyLive(d);
          } else {
            setOverallError(d.error ?? "No overall standings available yet.");
          }
        })
        .catch(() => !cancelled && setOverallError("Failed to load overall standings."))
        .finally(() => !cancelled && setOverallLoading(false));
    };

    load();
    const test = isTestEventId(selected.rallysafeId ?? selected.eventId);
    const interval = setInterval(load, test ? 2_000 : 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selected, view, isAraEvent, useEwrc]);

  // Resolve results.statusas.com event id lazily, only when the Stage/Split Times tab is opened
  useEffect(() => {
    if (!selected || view !== "stagetimes") return;
    setResolving(true);
    setIframeError("");
    setResultsEventId(null);
    fetch(`/api/events/${selected.rallysafeId ?? selected.eventId}/results-id`)
      .then((r) => r.json())
      .then((d) => {
        if (d.resultsEventId) setResultsEventId(d.resultsEventId);
        else setIframeError("No stage/split times page available for this event yet.");
      })
      .catch(() => setIframeError("Failed to load stage/split times."))
      .finally(() => setResolving(false));
  }, [selected, view]);

  return (
    <div className="min-h-[calc(100dvh-49px)] flex flex-col">
      <div className="border-b border-white/10 bg-brand-teal px-4 py-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center min-w-0 overflow-hidden">
        <span className="text-xs font-mono uppercase tracking-widest text-white font-bold shrink-0">
          🏁 Results
        </span>
        {loading ? (
          <span className="text-sm text-white/70">Loading events…</span>
        ) : (
          <select
            className="bg-brand-ink border border-white/10 rounded-md px-3 py-1.5 text-sm text-neutral-100 w-full max-w-full min-w-0 sm:max-w-xs"
            value={selected?.key ?? ""}
            onChange={(e) => {
              const ev = events.find((ev) => ev.key === e.target.value);
              setSelected(ev ?? null);
              setServiceCarNumber(null);
              setCompareB(null);
              setStageA(null);
              setStageB(null);
            }}
          >
            {events.map((ev) => (
              <option key={ev.key} value={ev.key}>
                {ev.from ? `${ev.from} · ` : ""}
                {ev.name}
              </option>
            ))}
          </select>
        )}

        <div className="sm:ml-auto flex gap-1 bg-black/20 rounded-full p-1 w-full sm:w-auto overflow-x-auto">
          <button
            onClick={() => setView("overall")}
            className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wide rounded-full transition-colors ${
              view === "overall" ? "bg-brand-gold text-brand-ink font-bold" : "text-white/70 hover:text-white"
            }`}
          >
            Overall (Live)
          </button>
          <button
            onClick={() => setView("stagetimes")}
            className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wide rounded-full transition-colors ${
              view === "stagetimes" ? "bg-brand-gold text-brand-ink font-bold" : "text-white/70 hover:text-white"
            }`}
          >
            Stage / Split Times
          </button>
        </div>
      </div>

      {view === "overall" ? (
        <div
          className="flex-1 overflow-y-auto bg-[#0a0e14]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 7px)",
          }}
        >
          {overallLoading && !overall ? (
            <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
              Loading overall standings…
            </div>
          ) : overallError ? (
            <div className="flex flex-col items-center justify-center h-full text-neutral-500 text-sm gap-2 px-6 text-center">
              <p>{overallError}</p>
              <p className="text-xs text-neutral-600 max-w-md">
                Live overall standings are computed from real stage times as they come in. This
                appears once the event has data flowing for the current rally weekend.
              </p>
            </div>
          ) : overall ? (
            <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-6 py-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-[family-name:var(--font-display)] text-lg text-white tracking-tight">{overall.title}</h2>
                <span className="text-xs text-neutral-500 font-mono">
                  {overall.stagesCompleted ?? 0} / {overall.stages.length} stages
                  {useEwrc && overall.stages.some((s) => s.fullyCancelled) && (
                    <span className="text-neutral-600"> · {overall.stages.filter((s) => s.fullyCancelled).length} cancelled</span>
                  )}
                </span>
              </div>
              {overall.source === "fallback" && (
                <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-300/90">
                  ⚠️ Live times from RallySafe only — official results (combiner / eWRC) aren&apos;t
                  available for this event right now. Totals are the sum of published stage times
                  and may not include clerk penalties.
                  {overall.hasAnyIncompleteData && " Cars missing a stage time are flagged."}
                </div>
              )}
              {(() => {
                const national = overall.standings.filter((r) => r.board === "national");
                const regional = overall.standings.filter((r) => r.board === "regional");
                const split = national.length > 0 && regional.length > 0;
                if (!split) {
                  return (
                    <StandingsBoard
                      rows={overall.standings}
                      serviceCarNumber={serviceCarNumber}
                      compareB={compareB}
                      onRowClick={handleRowClick}
                      onRowContext={handleRowContext}
                      onRowDouble={handleRowDouble}
                      extended={useEwrc}
                    />
                  );
                }
                return (
                  <>
                    <StandingsBoard
                      title="National"
                      rows={national}
                      serviceCarNumber={serviceCarNumber}
                      compareB={compareB}
                      onRowClick={handleRowClick}
                      onRowContext={handleRowContext}
                      onRowDouble={handleRowDouble}
                      extended={useEwrc}
                    />
                    <StandingsBoard
                      title="Regional"
                      rows={regional}
                      serviceCarNumber={serviceCarNumber}
                      compareB={compareB}
                      onRowClick={handleRowClick}
                      onRowContext={handleRowContext}
                      onRowDouble={handleRowDouble}
                      extended={useEwrc}
                    />
                  </>
                );
              })()}
              <p className="text-xs text-neutral-600 mt-3">
                {useEwrc
                  ? "Official eWRC results (penalties included in the total). Click a row for stage times. Right-click another car to compare. Double-click opens their eWRC profile."
                  : isAraEvent
                    ? "Refreshes every 20s. Totals match Sneak Attack Rally: stage times plus penalties; cancelled stages stay on the itinerary but add no time. Tap a car for its stage-by-stage times and predicted service times."
                    : "Refreshes every 20s. Totals sum stage times plus penalties when the feed has them. DNF cars shown grayed out at the bottom. Tap a car for its stage times. Service estimates aren't available for this event (ARA events only)."}
              </p>

              {useEwrc && (overall.surface || overall.totalDistanceKm || overall.mapUrl) && (
                <p className="text-xs text-neutral-600 mt-1 flex flex-wrap gap-x-3">
                  {overall.surface && <span className="capitalize">{overall.surface}</span>}
                  {typeof overall.totalDistanceKm === "number" && overall.totalDistanceKm > 0 && (
                    <span>{overall.totalDistanceKm.toFixed(1)} km total</span>
                  )}
                  {typeof overall.starters === "number" && (
                    <span>
                      {overall.finishers}/{overall.starters} finished
                    </span>
                  )}
                  {overall.mapUrl && (
                    <a href={overall.mapUrl} target="_blank" rel="noreferrer" className="text-brand-gold hover:underline">
                      Route & stage maps ↗
                    </a>
                  )}
                </p>
              )}

              {useEwrc && overall.penalties && overall.penalties.length > 0 && (
                <div className="mt-4 rounded-2xl bg-[#11151c] border border-white/10 p-4">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-white mb-3">Penalties</h3>
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {overall.penalties.map((p, i) => (
                      <div key={i} className="flex justify-between gap-3 text-xs font-mono">
                        <span className="text-neutral-400 truncate">
                          #{p.carNumber} {p.driverName}
                          {p.stageNumber ? ` · SS${p.stageNumber}` : ""}
                        </span>
                        <span className="text-red-400 shrink-0 text-right">
                          {p.penaltyPretty} <span className="text-neutral-600">— {p.reason}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {useEwrc && overall.retirements && overall.retirements.length > 0 && (
                <div className="mt-4 rounded-2xl bg-[#11151c] border border-white/10 p-4">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-white mb-3">Retirements</h3>
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {overall.retirements.map((r, i) => (
                      <div key={i} className="flex justify-between gap-3 text-xs font-mono">
                        <span className="text-neutral-400 truncate">
                          #{r.carNumber} {r.driverName} / {r.codriverName}
                          {r.stageNumber ? ` · SS${r.stageNumber}` : ""}
                        </span>
                        <span className="text-neutral-500 shrink-0 text-right">{r.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {useEwrc && overall.serviceWindows && overall.serviceWindows.length > 0 && (
                <div className="mt-4 rounded-2xl bg-[#11151c] border border-white/10 p-4">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-white mb-3">Service & Regroup Schedule</h3>
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {overall.serviceWindows.map((s, i) => (
                      <div key={i} className="flex justify-between gap-3 text-xs font-mono">
                        <span className="text-neutral-400 truncate">
                          Before SS{s.beforeStageNumber} — {s.name.replace(/^\s*-\s*/, "")}
                        </span>
                        <span className="text-neutral-500 shrink-0">{formatLocalIsoAsIs(s.time.replace(" ", "T"))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {serviceCarNumber !== null && overall.serviceIn.some((s) => s.number === serviceCarNumber) && (
                <div className="mt-4 rounded-2xl bg-[#11151c] border border-white/10 p-4">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-white mb-3">
                    Predicted Service Times for Car #{serviceCarNumber}{" "}
                    <span className="text-neutral-500 normal-case tracking-normal">
                      (rally-local time, UTC{overall.timeZone})
                    </span>
                  </h3>
                  {(() => {
                    const entries = overall.serviceIn
                      .filter((s) => s.number === serviceCarNumber)
                      .sort((a, b) => a.serviceNumber - b.serviceNumber);
                    if (entries.length === 0) {
                      return (
                        <p className="text-sm text-neutral-500">
                          No service predictions available for this car yet.
                        </p>
                      );
                    }
                    return (
                      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
                        {entries.map((s) => {
                          return (
                            <div key={s.serviceNumber} className="bg-black/40 border border-white/5 rounded-xl p-3">
                              <div className="text-xs text-neutral-500 font-mono uppercase mb-1">
                                Service {s.serviceNumber}
                              </div>
                              <div className="font-mono text-sm text-amber-400 font-bold">
                                In: {formatLocalIsoAsIs(s.due)}
                              </div>
                              <div className="font-mono text-sm text-neutral-300">
                                Out: {formatLocalIsoAsIs(addMinutesToLocalIso(s.due, SERVICE_OUT_MINS))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {useEwrc && serviceCarNumber !== null && overall.derivedServiceTimes?.some((s) => s.carNumber === serviceCarNumber) && (
                <div className="mt-4 rounded-2xl bg-[#11151c] border border-white/10 p-4">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-white mb-3">
                    Service In / Out — Car #{serviceCarNumber}
                  </h3>
                  <p className="text-xs text-neutral-600 mb-3">
                    Derived from this car&apos;s real, published start-order gap applied to the
                    field-wide schedule (RCR 1.3.3). Assumes no running-order reshuffle inside a leg.
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {overall.derivedServiceTimes
                      .filter((s) => s.carNumber === serviceCarNumber)
                      .map((s, i) => (
                        <div key={i} className="bg-black/40 border border-white/5 rounded-xl p-3">
                          <div className="text-xs text-neutral-500 font-mono uppercase mb-1">{s.serviceName}</div>
                          <div className="font-mono text-sm text-amber-400 font-bold">
                            In: {formatLocalIsoAsIs(s.inTime.replace(" ", "T"))}
                          </div>
                          <div className="font-mono text-sm text-neutral-300">
                            Out: {formatLocalIsoAsIs(s.outTime.replace(" ", "T"))}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {(stageA || stageB) && (
                <div className={`mt-4 grid gap-3 ${stageA && stageB ? "md:grid-cols-2" : ""}`}>
                  {[stageA, stageB].filter(Boolean).map((pack) => (
                    <div key={pack!.car} className="rounded-2xl bg-[#11151c] border border-white/10 p-4">
                      <h3 className="text-xs font-mono uppercase tracking-widest text-white mb-3">
                        Stage times · #{pack!.car} {pack!.driver}
                      </h3>
                      <div className="space-y-1 max-h-80 overflow-y-auto">
                        {pack!.stages.map((s) => (
                          <div key={`${pack!.car}-${s.stageNumber}`} className="flex justify-between gap-3 text-xs font-mono">
                            <span className="text-neutral-400 truncate">
                              SS{s.stageNumber} {s.name}
                              {s.cancelled ? " · CAN" : ""}
                            </span>
                            <span className="text-neutral-100 shrink-0">
                              {s.time}
                              {s.pos != null ? ` · P${s.pos}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : resolving ? (
        <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm bg-[#0a0e14]">
          Loading stage/split times…
        </div>
      ) : iframeError ? (
        <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm bg-[#0a0e14]">
          {iframeError}
        </div>
      ) : resultsEventId ? (
        <iframe
          key={resultsEventId}
          src={`https://results.statusas.com/events/${resultsEventId}/stagetimes`}
          className="flex-1 w-full border-0"
          title="RallySafe Results"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm bg-[#0a0e14]">
          No live/upcoming events found right now.
        </div>
      )}

      {showAraOnlyToast && (
        <div className="ara-toast fixed bottom-6 left-1/2 z-50 bg-brand-ink border border-brand-gold/40 text-white text-sm rounded-xl px-4 py-3 shadow-lg shadow-black/50 max-w-xs text-center">
          🔒 Service estimates are only available for ARA events.
        </div>
      )}
    </div>
  );
}

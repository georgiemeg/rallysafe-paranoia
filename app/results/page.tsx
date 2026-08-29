"use client";

import { useEffect, useState } from "react";

interface RSEvent {
  eventId: number;
  name: string;
}

interface OverallStanding {
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
  penaltySecondsNet: number;
}

interface ServiceEntry {
  serviceNumber: number;
  number: number;
  due: string;
}

interface OverallResponse {
  title: string;
  stages: { name: string; status: string; length: number }[];
  standings: OverallStanding[];
  serviceIn: ServiceEntry[];
  timeZone: string;
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

export default function ResultsPage() {
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
  const [showAraOnlyToast, setShowAraOnlyToast] = useState(false);

  useEffect(() => {
    fetch("/api/events/active")
      .then((r) => r.json())
      .then((d) => {
        const list: RSEvent[] = d.events ?? [];
        setEvents(list);
        setAraEventIds(new Set<number>(d.araEventIds ?? []));
        const activeId = d.activeEventId ?? list[0]?.eventId ?? null;
        setSelected(list.find((ev) => ev.eventId === activeId) ?? list[0] ?? null);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const isAraEvent = selected ? araEventIds.has(selected.eventId) : false;

  const handleRowClick = (carNumber: number) => {
    if (!isAraEvent) {
      setShowAraOnlyToast(true);
      window.setTimeout(() => setShowAraOnlyToast(false), 3000);
      return;
    }
    setServiceCarNumber(carNumber === serviceCarNumber ? null : carNumber);
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
      const url = isAraEvent
        ? `/api/results/overall?eventName=${encodeURIComponent(selected.name)}`
        : `/api/events/${selected.eventId}/overall-official`;
      fetch(url)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.standings) setOverall({ title: selected.name, ...d });
          else setOverallError(d.error ?? "No overall standings available yet.");
        })
        .catch(() => !cancelled && setOverallError("Failed to load overall standings."))
        .finally(() => !cancelled && setOverallLoading(false));
    };

    load();
    const interval = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selected, view, isAraEvent]);

  // Resolve results.statusas.com event id lazily, only when the Stage/Split Times tab is opened
  useEffect(() => {
    if (!selected || view !== "stagetimes") return;
    setResolving(true);
    setIframeError("");
    setResultsEventId(null);
    fetch(`/api/events/${selected.eventId}/results-id`)
      .then((r) => r.json())
      .then((d) => {
        if (d.resultsEventId) setResultsEventId(d.resultsEventId);
        else setIframeError("No stage/split times page available for this event yet.");
      })
      .catch(() => setIframeError("Failed to load stage/split times."))
      .finally(() => setResolving(false));
  }, [selected, view]);

  return (
    <div className="h-[calc(100vh-49px)] flex flex-col">
      <div className="border-b border-white/10 bg-brand-teal px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-mono uppercase tracking-widest text-white font-bold">
          🏁 Results
        </span>
        {loading ? (
          <span className="text-sm text-white/70">Loading events…</span>
        ) : (
          <select
            className="bg-brand-ink border border-white/10 rounded-md px-3 py-1.5 text-sm text-neutral-100"
            value={selected?.eventId ?? ""}
            onChange={(e) => {
              const ev = events.find((ev) => ev.eventId === Number(e.target.value));
              setSelected(ev ?? null);
            }}
          >
            {events.map((ev) => (
              <option key={ev.eventId} value={ev.eventId}>
                {ev.name}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex gap-1 bg-black/20 rounded-full p-1">
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
                Live overall standings are computed from real stage times as they come in — this
                appears once the event has data flowing for the current rally weekend.
              </p>
            </div>
          ) : overall ? (
            <div className="max-w-4xl mx-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-[family-name:var(--font-display)] text-lg text-white tracking-tight">{overall.title}</h2>
                <span className="text-xs text-neutral-500 font-mono">
                  {overall.stages.filter((s) => s.status === "Completed").length} / {overall.stages.length} stages done
                </span>
              </div>
              {!isAraEvent && (
                <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-300/90">
                  ⚠️ Penalty data is not available for this event (non-ARA events only — official
                  penalties are published separately by each rally and aren&apos;t exposed on the
                  public live-tracking feed this table is built from). Times/positions shown are
                  accurate but may not reflect penalties applied after the fact.
                </div>
              )}
              <div className="rounded-xl border border-white/10 bg-[#11151c] overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="bg-white/[0.04] text-neutral-500 text-xs uppercase tracking-wide font-mono">
                      <th className="text-left px-3 py-2">Pos</th>
                      <th className="text-left px-3 py-2">Car</th>
                      <th className="text-left px-3 py-2">Driver / Co-Driver</th>
                      <th className="text-left px-3 py-2">Class</th>
                      <th className="text-right px-3 py-2">Total</th>
                      <th className="text-right px-3 py-2">Gap</th>
                      <th className="text-right px-3 py-2">Interval</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {overall.standings.map((row) => (
                      <tr
                        key={row.number}
                        className={`font-mono cursor-pointer hover:bg-white/[0.04] transition-colors ${row.isRetired ? "opacity-40" : ""} ${
                          row.isPenalized
                            ? "bg-[#CD7F32]/10"
                            : row.position === 1
                              ? "bg-amber-400/10"
                              : row.position === 2
                                ? "bg-[#C0C0C0]/10"
                                : row.position === 3
                                  ? "bg-[#CD7F32]/10"
                                  : ""
                        } ${serviceCarNumber === row.number ? "selected-row-tape" : ""}`}
                        onClick={() => handleRowClick(row.number)}
                      >
                        <td className="px-3 py-2">
                          {row.position <= 3 ? (
                            <span
                              className={`flex items-center justify-center w-6 h-6 rounded-full font-bold text-xs ${
                                row.position === 1
                                  ? "bg-amber-400 text-black"
                                  : row.position === 2
                                    ? "bg-[#C0C0C0] text-black"
                                    : "bg-[#CD7F32] text-black"
                              }`}
                            >
                              {row.position}
                            </span>
                          ) : (
                            <span className="text-neutral-500">{row.position}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="font-bold"
                            style={
                              row.position === 1
                                ? {
                                    color: "#fbbf24",
                                    filter: row.isRetired ? undefined : "drop-shadow(0 0 7px rgba(251,191,36,0.9))",
                                  }
                                : row.position === 2
                                  ? {
                                      color: "#C0C0C0",
                                      filter: row.isRetired ? undefined : "drop-shadow(0 0 7px rgba(224,224,224,0.9))",
                                    }
                                  : row.position === 3
                                    ? {
                                        color: "#CD7F32",
                                        filter: row.isRetired ? undefined : "drop-shadow(0 0 8px rgba(205,127,50,0.95))",
                                      }
                                    : {
                                        color: "#00A8C4",
                                        filter: row.isRetired ? undefined : "drop-shadow(0 0 7px rgba(0,168,196,0.9))",
                                      }
                            }
                          >
                            #{row.number}
                          </span>
                          {row.isRetired && <span className="ml-2 text-neutral-500 text-xs">DNF</span>}
                          {row.isPenalized && (
                            <span className="ml-2 text-red-400 text-xs font-bold drop-shadow-[0_0_6px_rgba(248,113,113,0.85)]">
                              PEN
                              {row.penaltySecondsNet !== 0 && (
                                <span
                                  className={`ml-1 ${
                                    row.penaltySecondsNet > 0
                                      ? "text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.85)]"
                                      : "text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.85)]"
                                  }`}
                                >
                                  {row.penaltySecondsNet > 0 ? "+" : "-"}
                                  {Math.abs(row.penaltySecondsNet)}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-neutral-200 font-sans text-xs whitespace-nowrap">
                          {row.driverName} / {row.codriverName}
                        </td>
                        <td className="px-3 py-2 text-neutral-500">{row.carClass}</td>
                        <td className="px-3 py-2 text-right text-neutral-100 font-bold">{msToClock(row.totalMs)}</td>
                        <td className="px-3 py-2 text-right text-neutral-400">{gapLabel(row.gapToLeaderMs)}</td>
                        <td className="px-3 py-2 text-right text-neutral-600">{gapLabel(row.gapToAheadMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-neutral-600 mt-3">
                {isAraEvent
                  ? "Refreshes automatically every 20s. Totals sum every completed stage time; DNF cars shown grayed out at the bottom. Click a row to see that car's predicted service times below."
                  : "Refreshes automatically every 20s. Totals sum every completed stage time; DNF cars shown grayed out at the bottom. Service estimates aren't available for this event (ARA events only)."}
              </p>

              {serviceCarNumber !== null && (
                <div className="mt-4 rounded-2xl bg-[#11151c] border border-white/10 p-4">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-white mb-3">
                    Predicted Service Times — Car #{serviceCarNumber}{" "}
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
                                {formatLocalIsoAsIs(s.due)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
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

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

  useEffect(() => {
    fetch("/api/events/active")
      .then((r) => r.json())
      .then((d) => {
        const list: RSEvent[] = d.events ?? [];
        setEvents(list);
        const activeId = d.activeEventId ?? list[0]?.eventId ?? null;
        setSelected(list.find((ev) => ev.eventId === activeId) ?? list[0] ?? null);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  // Poll overall standings every 20s while that view is active
  useEffect(() => {
    if (!selected || view !== "overall") return;
    let cancelled = false;

    const load = () => {
      setOverallLoading(true);
      setOverallError("");
      fetch(`/api/results/overall?eventName=${encodeURIComponent(selected.name)}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.standings) setOverall(d);
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
  }, [selected, view]);

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
        <div className="flex-1 overflow-y-auto bg-canvas">
          {overallLoading && !overall ? (
            <div className="flex items-center justify-center h-full text-brand-ink/60 text-sm">
              Loading overall standings…
            </div>
          ) : overallError ? (
            <div className="flex flex-col items-center justify-center h-full text-brand-ink/60 text-sm gap-2 px-6 text-center">
              <p>{overallError}</p>
              <p className="text-xs text-brand-ink/50 max-w-md">
                Live overall standings are computed from real stage times as they come in — this
                appears once the event has data flowing for the current rally weekend.
              </p>
            </div>
          ) : overall ? (
            <div className="max-w-4xl mx-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-[family-name:var(--font-display)] text-lg text-brand-ink tracking-tight">{overall.title}</h2>
                <span className="text-xs text-brand-ink/50 font-mono">
                  {overall.stages.filter((s) => s.status === "Completed").length} / {overall.stages.length} stages done
                </span>
              </div>
              <div className="rounded-xl border border-brand-ink/10 overflow-hidden bg-white/40">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-brand-ink/5 text-brand-ink/60 text-xs uppercase tracking-wide font-mono">
                      <th className="text-left px-3 py-2">Pos</th>
                      <th className="text-left px-3 py-2">Car</th>
                      <th className="text-left px-3 py-2">Driver / Co-Driver</th>
                      <th className="text-left px-3 py-2">Class</th>
                      <th className="text-right px-3 py-2">Total</th>
                      <th className="text-right px-3 py-2">Gap</th>
                      <th className="text-right px-3 py-2">Interval</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-ink/10">
                    {overall.standings.map((row) => (
                      <tr
                        key={row.number}
                        className={`font-mono cursor-pointer hover:bg-brand-ink/[0.04] transition-colors ${row.isRetired ? "opacity-40" : ""} ${
                          row.position === 1
                            ? "bg-brand-gold/15"
                            : row.position === 2
                              ? "bg-brand-teal/15"
                              : row.position === 3
                                ? "bg-brand-orange/15"
                                : ""
                        } ${serviceCarNumber === row.number ? "ring-1 ring-inset ring-brand-gold" : ""}`}
                        onClick={() => setServiceCarNumber(row.number === serviceCarNumber ? null : row.number)}
                      >
                        <td className="px-3 py-2">
                          {row.position <= 3 ? (
                            <span
                              className={`flex items-center justify-center w-6 h-6 rounded-full text-brand-ink font-bold text-xs ${
                                row.position === 1 ? "bg-brand-gold" : row.position === 2 ? "bg-brand-teal text-white" : "bg-brand-orange"
                              }`}
                            >
                              {row.position}
                            </span>
                          ) : (
                            <span className="text-brand-ink/50">{row.position}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-brand-gold font-bold">#{row.number}</span>
                          {row.isRetired && <span className="ml-2 text-brand-maroon text-xs">DNF</span>}
                          {row.isPenalized && <span className="ml-2 text-brand-orange text-xs">PEN</span>}
                        </td>
                        <td className="px-3 py-2 text-brand-ink font-sans text-xs whitespace-nowrap">
                          {row.driverName} / {row.codriverName}
                        </td>
                        <td className="px-3 py-2 text-brand-ink/60">{row.carClass}</td>
                        <td className="px-3 py-2 text-right text-brand-ink">{msToClock(row.totalMs)}</td>
                        <td className="px-3 py-2 text-right text-brand-ink/70">{gapLabel(row.gapToLeaderMs)}</td>
                        <td className="px-3 py-2 text-right text-brand-ink/50">{gapLabel(row.gapToAheadMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-brand-ink/50 mt-3">
                Refreshes automatically every 20s. Totals sum every completed stage time; DNF cars
                shown grayed out at the bottom. Click a row to see that car&apos;s predicted
                service times below.
              </p>

              {serviceCarNumber !== null && (
                <div className="mt-4 rounded-2xl bg-brand-maroon p-4">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-white mb-3">
                    Predicted Service Times — Car #{serviceCarNumber}{" "}
                    <span className="text-white/60 normal-case tracking-normal">
                      (rally-local time, UTC{overall.timeZone})
                    </span>
                  </h3>
                  {(() => {
                    const entries = overall.serviceIn
                      .filter((s) => s.number === serviceCarNumber)
                      .sort((a, b) => a.serviceNumber - b.serviceNumber);
                    if (entries.length === 0) {
                      return (
                        <p className="text-sm text-white/70">
                          No service predictions available for this car yet.
                        </p>
                      );
                    }
                    return (
                      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
                        {entries.map((s) => {
                          return (
                            <div key={s.serviceNumber} className="bg-black/25 rounded-xl p-3">
                              <div className="text-xs text-white/60 font-mono uppercase mb-1">
                                Service {s.serviceNumber}
                              </div>
                              <div className="font-mono text-sm text-brand-gold font-bold">
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
        <div className="flex-1 flex items-center justify-center text-brand-ink/60 text-sm bg-canvas">
          Loading stage/split times…
        </div>
      ) : iframeError ? (
        <div className="flex-1 flex items-center justify-center text-brand-ink/60 text-sm bg-canvas">
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
        <div className="flex-1 flex items-center justify-center text-brand-ink/60 text-sm bg-canvas">
          No live/upcoming events found right now.
        </div>
      )}
    </div>
  );
}

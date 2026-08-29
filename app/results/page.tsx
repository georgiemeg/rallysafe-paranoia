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
  stagesCompleted: number;
  totalMs: number;
  gapToLeaderMs: number;
  gapToAheadMs: number;
  isRetired: boolean;
  isPenalized: boolean;
}

interface OverallResponse {
  title: string;
  stages: { name: string; status: string; length: number }[];
  standings: OverallStanding[];
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

  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((d) => {
        const list: RSEvent[] = d.events ?? [];
        setEvents(list);
        if (list.length > 0) setSelected(list[0]);
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
      <div className="border-b border-white/10 bg-[#0a0d14] px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-mono uppercase tracking-widest text-emerald-400/80">
          🏁 Results
        </span>
        {loading ? (
          <span className="text-sm text-neutral-500">Loading events…</span>
        ) : (
          <select
            className="bg-neutral-900 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-100"
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

        <div className="ml-auto flex gap-1 bg-black/30 rounded-md p-1">
          <button
            onClick={() => setView("overall")}
            className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wide rounded ${
              view === "overall" ? "bg-emerald-600 text-white" : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            Overall (Live)
          </button>
          <button
            onClick={() => setView("stagetimes")}
            className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wide rounded ${
              view === "stagetimes" ? "bg-emerald-600 text-white" : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            Stage / Split Times
          </button>
        </div>
      </div>

      {view === "overall" ? (
        <div className="flex-1 overflow-y-auto bg-[#05070c]">
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
                <h2 className="font-mono text-sm text-neutral-300">{overall.title}</h2>
                <span className="text-xs text-neutral-600 font-mono">
                  {overall.stages.filter((s) => s.status === "Completed").length} / {overall.stages.length} stages done
                </span>
              </div>
              <div className="rounded-lg border border-white/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white/[0.03] text-neutral-500 text-xs uppercase tracking-wide font-mono">
                      <th className="text-left px-3 py-2">Pos</th>
                      <th className="text-left px-3 py-2">Car</th>
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
                        className={`font-mono ${row.isRetired ? "opacity-40" : ""} ${row.position <= 3 ? "bg-emerald-400/[0.03]" : ""}`}
                      >
                        <td className="px-3 py-2 text-neutral-400">{row.position}</td>
                        <td className="px-3 py-2">
                          <span className="text-emerald-400">#{row.number}</span>
                          {row.isRetired && <span className="ml-2 text-red-400 text-xs">DNF</span>}
                          {row.isPenalized && <span className="ml-2 text-yellow-400 text-xs">PEN</span>}
                        </td>
                        <td className="px-3 py-2 text-neutral-500">{row.carClass}</td>
                        <td className="px-3 py-2 text-right">{msToClock(row.totalMs)}</td>
                        <td className="px-3 py-2 text-right text-neutral-400">{gapLabel(row.gapToLeaderMs)}</td>
                        <td className="px-3 py-2 text-right text-neutral-600">{gapLabel(row.gapToAheadMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-neutral-600 mt-3">
                Refreshes automatically every 20s. Totals sum every completed stage time; DNF cars
                shown grayed out at the bottom.
              </p>
            </div>
          ) : null}
        </div>
      ) : resolving ? (
        <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
          Loading stage/split times…
        </div>
      ) : iframeError ? (
        <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
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
        <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
          No live/upcoming events found right now.
        </div>
      )}
    </div>
  );
}

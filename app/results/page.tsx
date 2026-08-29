"use client";

import { useEffect, useState } from "react";

interface RSEvent {
  eventId: number;
  name: string;
}

export default function ResultsPage() {
  const [events, setEvents] = useState<RSEvent[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [resultsEventId, setResultsEventId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((d) => {
        const list: RSEvent[] = d.events ?? [];
        setEvents(list);
        if (list.length > 0) setSelected(list[0].eventId);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setResolving(true);
    setError("");
    setResultsEventId(null);
    fetch(`/api/events/${selected}/results-id`)
      .then((r) => r.json())
      .then((d) => {
        if (d.resultsEventId) setResultsEventId(d.resultsEventId);
        else setError("No results page available for this event yet.");
      })
      .catch(() => setError("Failed to load results."))
      .finally(() => setResolving(false));
  }, [selected]);

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
            value={selected ?? ""}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {events.map((ev) => (
              <option key={ev.eventId} value={ev.eventId}>
                {ev.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {resolving ? (
        <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
          Loading results…
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
          {error}
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

"use client";

import { useEffect, useState } from "react";

interface RSEvent {
  eventId: number;
  name: string;
}

export default function LivePage() {
  const [events, setEvents] = useState<RSEvent[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/events/active")
      .then((r) => r.json())
      .then((d) => {
        const list: RSEvent[] = d.events ?? [];
        setEvents(list);
        setSelected(d.activeEventId ?? list[0]?.eventId ?? null);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="h-[calc(100vh-49px)] flex flex-col">
      <div className="border-b border-white/10 bg-brand-orange px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-mono uppercase tracking-widest text-white font-bold">
          📡 Live Tracking
        </span>
        {loading ? (
          <span className="text-sm text-white/70">Loading events…</span>
        ) : (
          <select
            className="bg-brand-ink border border-white/10 rounded-md px-3 py-1.5 text-sm text-neutral-100"
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
      {selected ? (
        <iframe
          key={selected}
          src={`https://rc.statusas.com/events/${selected}/details#map`}
          className="flex-1 w-full border-0"
          title="RallySafe Live Map"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
          No live/upcoming events found right now.
        </div>
      )}
    </div>
  );
}

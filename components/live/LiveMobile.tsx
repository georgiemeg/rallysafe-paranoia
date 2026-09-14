"use client";

import { useEffect, useState } from "react";
import { LiveMap, type MapPos } from "@/components/live/LiveMap";

interface RSEvent {
  eventId: number;
  name: string;
}

export function LiveMobile() {
  const [events, setEvents] = useState<RSEvent[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<MapPos[]>([]);

  useEffect(() => {
    fetch("/api/events/active?live=1")
      .then((r) => r.json())
      .then((d) => {
        const list: RSEvent[] = d.events ?? [];
        setEvents(list);
        setSelected(d.activeEventId ?? list[0]?.eventId ?? null);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const load = () => {
      fetch(`/api/events/${selected}/positions`)
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled) setPositions(d.positions ?? []);
        })
        .catch(() => {
          if (!cancelled) setPositions([]);
        });
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [selected]);

  const pts = positions.filter((p) => p.lat && p.lon);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#0a0e14]">
      <div className="border-b border-white/10 bg-brand-golden-orange px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-mono uppercase tracking-widest text-white font-bold">
          📡 Live Tracking
        </span>
        {loading ? (
          <span className="text-base text-white/70">Loading events…</span>
        ) : (
          <select
            className="bg-brand-ink border border-white/10 rounded-md px-3 py-2 text-base text-neutral-100"
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
        <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
          <LiveMap positions={pts} />
          <a
            href={`https://rc.statusas.com/events/${selected}/details#map`}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-2xl bg-[#11151c] border border-white/10 px-4 py-3"
          >
            <div className="text-base font-bold text-white">Open RallySafe map</div>
            <div className="text-sm text-neutral-400 mt-0.5">Official live tracking in a new tab</div>
          </a>
          <div className="rounded-2xl bg-[#11151c] border border-white/10 divide-y divide-white/5">
            {pts.slice(0, 40).map((p) => (
              <div key={p.entryId} className="px-4 py-2 flex justify-between text-base">
                <span className="font-mono text-brand-gold">#{p.identifier}</span>
                <span className="text-neutral-400">
                  {p.speed} · {p.status === 1 ? "on stage" : "transit"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-neutral-500 text-base">
          No live/upcoming events found right now.
        </div>
      )}
    </div>
  );
}

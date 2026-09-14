"use client";

import { useState } from "react";
import itinerary from "@/lib/sim/seed/itinerary.json";

export type TrackDot = {
  number: string;
  driver: string;
  carClass: string;
  kind: "waiting" | "stage" | "transit" | "service" | "regroup" | "overnight" | "done";
  stage: number;
  progress: number;
  label: string;
  from?: string;
  to?: string;
  slot: number;
};

type After = { kind: string; min: number; from?: string; to?: string; name?: string };

export function SimRallyGraphic({
  dots,
  playing,
  onIncident,
}: {
  dots: TrackDot[];
  playing?: boolean;
  onIncident?: (kind: "retire" | "puncture" | "pass", car: string) => void;
}) {
  const rows = itinerary as { n: number; name: string; after?: After[] }[];
  const [menu, setMenu] = useState<{ car: string; driver: string; kind: TrackDot["kind"]; x: number; y: number } | null>(null);

  const click = (d: TrackDot, ev: React.MouseEvent) => {
    ev.stopPropagation();
    setMenu({ car: d.number, driver: d.driver, kind: d.kind, x: ev.clientX, y: ev.clientY });
  };

  return (
    <section className="rounded-xl border border-white/10 bg-[#11151c] p-4 space-y-3" onClick={() => setMenu(null)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
          National field — {playing ? "running" : "idle"}
        </div>
        <div className="text-[10px] font-mono text-neutral-500">
          {dots.filter((d) => d.kind === "stage").length} on stage · {dots.filter((d) => d.kind === "transit").length} transit · {dots.filter((d) => d.kind === "service").length} service · {dots.filter((d) => d.kind === "overnight").length} overnight
        </div>
      </div>
      <div className="max-h-[32rem] overflow-y-auto space-y-3 pr-1">
        <Strip
          title="MTC OUT → SS1 (13 min)"
          dashed
          cars={dots.filter((d) => d.kind === "waiting" || (d.kind === "transit" && d.from === "MTC OUT"))}
          onCar={click}
        />
        {rows.map((s) => (
          <div key={s.n} className="space-y-2">
            <Strip title={`SS${s.n}  ${s.name.replace(/^SS\d+\s/, "")}`} start="START" end="FINISH" cars={dots.filter((d) => d.kind === "stage" && d.stage === s.n)} onCar={click} />
            {(s.after || []).map((a, i) => {
              const title =
                a.kind === "service"
                  ? `${a.name} (${a.min} min)`
                  : a.kind === "overnight"
                    ? `${a.name} (${a.min} min) — ${a.from} → ${a.to}`
                    : a.kind === "regroup"
                      ? `${a.name} (${a.min} min) — ${a.from} → ${a.to}`
                      : `${a.from} → ${a.to} (${a.min} min)`;
              const parked = a.kind === "service" || a.kind === "overnight" || a.kind === "regroup";
              const cars = dots.filter((d) => {
                if (d.kind !== a.kind || d.stage !== s.n) return false;
                if (a.kind === "transit") return d.from === a.from && d.to === a.to;
                if (a.name) return d.label.includes(a.name);
                return d.from === a.from && d.to === a.to;
              });
              return (
                <Strip
                  key={`${s.n}-${a.kind}-${i}`}
                  title={title}
                  dashed={a.kind === "transit"}
                  parked={parked}
                  cars={cars}
                  onCar={click}
                />
              );
            })}
          </div>
        ))}
      </div>
      {menu && (
        <div
          className="fixed z-50 rounded-lg border border-white/15 bg-[#0a0e14] p-2 shadow-xl text-xs font-mono min-w-[11rem]"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 160) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-neutral-400">#{menu.car} {menu.driver}</div>
          <button className="block w-full text-left px-2 py-1.5 hover:bg-white/10 rounded" onClick={() => { onIncident?.("retire", menu.car); setMenu(null); }}>
            Retire here
          </button>
          <button className="block w-full text-left px-2 py-1.5 hover:bg-white/10 rounded" onClick={() => { onIncident?.("puncture", menu.car); setMenu(null); }}>
            Puncture (90s–2 min stop)
          </button>
          <button className="block w-full text-left px-2 py-1.5 hover:bg-white/10 rounded" onClick={() => { onIncident?.("pass", menu.car); setMenu(null); }}>
            {menu.kind === "stage" ? "Push to pass (car ahead stops)" : "Pass on road (swap start order)"}
          </button>
        </div>
      )}
    </section>
  );
}

function Strip({
  title,
  start,
  end,
  dashed,
  parked,
  cars,
  onCar,
}: {
  title: string;
  start?: string;
  end?: string;
  dashed?: boolean;
  parked?: boolean;
  cars: TrackDot[];
  onCar: (d: TrackDot, ev: React.MouseEvent) => void;
}) {
  const startColor = dashed || parked ? "#f5c518" : "#22c55e";
  const endColor = dashed || parked ? "#f5c518" : "#ef4444";
  const lineColor = dashed || parked ? "#f5c518" : "rgba(255,255,255,0.25)";
  const COLS = 10;
  const ROWS = 3;
  const STALLS = COLS * ROWS;

  if (parked) {
    const stalls = Array.from({ length: STALLS }, (_, i) => cars.find((c, idx) => (c.slot >= 0 ? c.slot : idx) === i) || null);
    return (
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-1">{title} — paddock</div>
        <div className="rounded-md bg-black/40 border border-white/10 px-2 py-2 space-y-1.5">
          {Array.from({ length: ROWS }, (_, row) => (
            <div key={row} className="grid grid-cols-10 gap-1">
              {Array.from({ length: COLS }, (_, col) => {
                const i = row * COLS + col;
                const c = stalls[i];
                return (
                  <button
                    type="button"
                    key={i}
                    disabled={!c}
                    onClick={(ev) => c && onCar(c, ev)}
                    title={c ? `#${c.number} ${c.driver} ${c.label}` : `stall ${i + 1}`}
                    className={`h-8 rounded border flex flex-col items-center justify-center leading-none ${
                      c ? "border-[#3b82f6]/60 bg-[#3b82f6]/15 cursor-pointer" : "border-white/10 bg-white/[0.02] cursor-default"
                    }`}
                  >
                    {c ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6]" />
                        <span className="font-mono text-[8px] text-[#93c5fd]">#{c.number}</span>
                      </>
                    ) : (
                      <span className="w-1 h-1 rounded-full bg-white/15" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-1">{title}</div>
      <div className="relative h-12 rounded-md bg-black/40 border border-white/10">
        <div className="absolute left-8 right-8 top-[70%]" style={{ borderTop: dashed ? `1.5px dashed ${lineColor}` : `1.5px solid ${lineColor}` }} />
        <span className="absolute left-1 top-[70%] -translate-y-1/2 w-2.5 h-2.5 rounded-full" style={{ background: startColor }} title={start || "start"} />
        <span className="absolute right-1 top-[70%] -translate-y-1/2 w-2.5 h-2.5 rounded-full" style={{ background: endColor }} title={end || "end"} />
        {start && <span className="absolute left-4 top-0.5 text-[8px] font-mono" style={{ color: startColor }}>{start}</span>}
        {end && <span className="absolute right-4 top-0.5 text-[8px] font-mono" style={{ color: endColor }}>{end}</span>}
        {cars.map((c) => {
          const pct = 8 + Math.min(0.98, Math.max(0.02, c.progress)) * 84;
          return (
            <button
              type="button"
              key={c.number}
              className="absolute -translate-x-1/2 flex flex-col items-center leading-none cursor-pointer"
              style={{ left: `${pct}%`, top: 2 }}
              title={`#${c.number} ${c.driver} ${c.label}`}
              onClick={(ev) => onCar(c, ev)}
            >
              <span className="font-mono text-[9px] text-[#3b82f6] mb-0.5">#{c.number}</span>
              <span className="w-2 h-2 rounded-full bg-[#3b82f6]" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import itineraryFallback from "@/lib/sim/seed/itinerary.json";
import entriesSeed from "@/lib/sim/seed/entries.json";
import { SimRallyGraphic, type TrackDot } from "@/components/sim/SimRallyGraphic";

type UserRow = {
  id: string;
  username_display: string;
  username_normalized?: string;
  email: string | null;
  phone: string | null;
  last_login_at: number | null;
  created_at: number | null;
  can_gamble: boolean;
  role: string;
  poker_wins: number;
  poker_losses: number;
  country: string | null;
  bio: string | null;
  banned?: boolean;
};

type Stage = { n: number; name: string; cancelled: boolean; day: number };

const INJECTS = [
  ["started stage", "Start (racingStatus 1)"],
  ["finished stage", "Finish (racingStatus 0)"],
  ["posted time", "Times posted"],
  ["overall tick", "Overall tick"],
  ["stopped-on-stage", "Stopped 75s"],
  ["moved-again", "Moved again"],
  ["stale-GPS", "Stale GPS 60s"],
  ["penalty +10s", "Penalty +10s"],
  ["retired", "Retired"],
  ["SOS", "SOS / stopped 90s"],
];

function Tap({
  label,
  onClick,
  gold,
}: {
  label: string;
  onClick: () => Promise<void> | void;
  gold?: boolean;
}) {
  const [flash, setFlash] = useState(false);
  return (
    <button
      type="button"
      className={`relative overflow-hidden rounded-full px-3 py-1.5 text-xs font-mono uppercase tracking-widest transition-transform active:scale-90 ${
        gold ? "bg-brand-gold text-brand-ink" : "border border-white/10"
      } ${flash ? "ring-2 ring-brand-gold" : ""}`}
      onClick={async () => {
        setFlash(true);
        await onClick();
        setTimeout(() => setFlash(false), 500);
      }}
    >
      {flash && <span className="absolute inset-0 bg-white/30 animate-pulse" />}
      {label}
    </button>
  );
}

export function DevConsole() {
  const [data, setData] = useState<{
    users: UserRow[];
    sim: {
      completed: number;
      playing: boolean;
      speed: number;
      smsLive: boolean;
      selectedCar: string;
      selectedCars?: string[];
      playback: { mode?: string; stage: number; cars: { number: string }[] } | null;
    };
    track?: { playing: boolean; dots: TrackDot[]; overnight?: { label: string } | null };
    overall: { standings: { number: number; driverName: string; totalMs: number; isRetired: boolean }[]; stages: { name: string; status: string }[] };
    irregularities: { t: number; severity: string; source: string; message: string }[];
    itinerary?: Stage[];
    config?: { bulletinUrl?: string; serviceDurationsCsv?: string };
  } | null>(null);
  const [missing, setMissing] = useState(false);
  const [health, setHealth] = useState("");
  const [q, setQ] = useState("");
  const [gamble, setGamble] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [edit, setEdit] = useState<Record<string, { username: string; email: string; phone: string; password: string }>>({});
  const [showPass, setShowPass] = useState<Record<string, boolean>>({});
  const [bulletinUrl, setBulletinUrl] = useState("");
  const [serviceDurationsCsv, setServiceDurationsCsv] = useState("");

  const [fail, setFail] = useState("");

  const load = () =>
    fetch("/api/dev", { credentials: "include" })
      .then((r) => {
        if (r.status === 404) {
          setMissing(true);
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        if (!Array.isArray(d.users)) {
          setFail(d.error || "Dev tools loaded with no users.");
          setData({
            users: [],
            sim: d.sim || { completed: 0, playing: false, speed: 1, smsLive: false, selectedCar: "1", playback: null },
            overall: d.overall || { standings: [], stages: [] },
            irregularities: d.irregularities || [],
            itinerary: d.itinerary,
            track: d.track,
          });
          return;
        }
        setFail("");
        setData(d);
        setBulletinUrl(d.config?.bulletinUrl ?? "");
        setServiceDurationsCsv(d.config?.serviceDurationsCsv ?? "");
        setGamble((d.users as UserRow[]).filter((u) => u.can_gamble).map((u) => u.id));
      })
      .catch((e) => setFail(String(e)));

  useEffect(() => {
    load();
    fetch("/api/healthz")
      .then((r) => r.json())
      .then((d) => setHealth(`db ${d.db ? "ok" : "fail"} · ${d.ms}ms · ${d.region || "local"}`))
      .catch(() => setHealth("health fail"));
  }, []);

  useEffect(() => {
    if (!data?.sim.playing) return;
    let stop = false;
    const loop = async () => {
      while (!stop) {
        try {
          await fetch("/api/dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "tick" }) });
          if (!stop) await load();
        } catch {
          /* ignore */
        }
        if (stop) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    loop();
    return () => {
      stop = true;
    };
  }, [data?.sim.playing]);

  if (missing) return <div className="min-h-[calc(100dvh-49px)] bg-[#0a0e14] p-10 text-neutral-500">Not Found</div>;
  if (!data) {
    return (
      <div className="min-h-[calc(100dvh-49px)] bg-[#0a0e14] p-10 text-neutral-300 font-mono text-sm">
        Loading dev tools…{fail ? ` ${fail}` : ""}
      </div>
    );
  }

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    setNote(j.note || j.error || "Clicked — packet sent through the live poll.");
    await load();
  };

  const users = (data.users ?? []).filter((u) => `${u.username_display} ${u.email || ""} ${u.phone || ""}`.toLowerCase().includes(q.toLowerCase()));
  const stages = (data.itinerary as Stage[] | undefined) ?? (itineraryFallback as Stage[]);

  return (
    <div className="min-h-[calc(100dvh-49px)] bg-[#0a0e14] text-neutral-100">
      <div className="border-b border-white/10 bg-brand-maroon px-4 py-3 flex items-center gap-3">
        <span className="text-xs font-mono uppercase tracking-widest text-white font-bold">Dev Tools</span>
        <span className="text-xs font-mono text-white/70">{health}</span>
      </div>
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {note && <div className="sticky top-2 z-20 rounded-xl bg-brand-gold text-brand-ink px-4 py-2 text-sm font-mono">{note}</div>}

        <section className="rounded-xl border border-white/10 bg-[#11151c] p-4 space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Oregon Trail 2025 — fake RallySafe packets</div>
          <p className="text-sm text-neutral-400">
            Cursor after SS{data.sim.completed} · {data.sim.speed}x · SMS {data.sim.smsLive ? "ON" : "off"}.
            Start from MTC runs the whole National event. Panic freezes — Resume picks up from there.
            Alerts are controlled from the home page's &ldquo;choose who to track&rdquo; section, same as any user.
          </p>
          {data.sim.playing && data.sim.playback && (
            <p className="text-sm text-brand-gold font-mono">
              SS{data.sim.playback.stage} live — {data.track?.dots.filter((d) => d.kind === "stage").length ?? 0} on stage, {data.track?.dots.filter((d) => d.kind === "transit").length ?? 0} transit, {data.track?.dots.filter((d) => d.kind === "done").length ?? 0} finished
            </p>
          )}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-mono uppercase tracking-widest text-neutral-500">Clock</span>
            {[1, 10, 60, 120].map((s) => (
              <Tap key={s} gold={data.sim.speed === s} label={`${s}x`} onClick={() => post({ action: "cursor", ...data.sim, speed: s })} />
            ))}
            <Tap gold label="Start from MTC" onClick={() => post({ action: "script", name: "cold" })} />
            {!data.sim.playing && data.sim.playback && (
              <Tap gold label="Resume" onClick={() => post({ action: "resume" })} />
            )}
            <button
              type="button"
              className="rounded-full px-4 py-1.5 text-xs font-mono uppercase tracking-widest bg-red-600 text-white active:scale-90"
              onClick={() => post({ action: "panic" })}
            >
              Panic stop
            </button>
            <Tap label="Skip to finish MTC" onClick={() => post({ action: "script", name: "final" })} />
          </div>
          <p className="text-xs text-neutral-500">
            Gold cars are the ones fake packets/injects target. Last tap ({`#${data.sim.selectedCar}`}) is who packets hit.
            To actually get alerts (SMS/inbox), select cars under &ldquo;choose who to track&rdquo; on the home page — that's the real
            subscription list, same as any user.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={data.sim.smsLive} onChange={(e) => post({ action: "cursor", ...data.sim, smsLive: e.target.checked })} />
            Sim sends real SMS (off = inbox only)
          </label>
          {data.track?.overnight && (
            <Tap gold label="Skip to 30 min before first car out" onClick={() => post({ action: "skipOvernight" })} />
          )}
          <SimRallyGraphic
            dots={data.track?.dots ?? []}
            playing={data.sim.playing}
            onIncident={(kind, car) => post({ action: "incident", kind, car })}
          />

          <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 pt-2">Stages (start = racingStatus 1, finish = 1→0)</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {stages.map((s) => (
              <div key={s.n} className={`rounded-lg border border-white/10 p-2 ${data.sim.completed >= s.n ? "bg-white/5" : ""}`}>
                <div className="text-xs font-mono mb-2">
                  SS{s.n} {s.name.replace(/^SS\d+\s/, "")} {s.cancelled ? "(cancelled)" : ""} · day {s.day}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Tap label="Start" onClick={() => post({ action: "script", name: `ss${s.n}-start` })} />
                  <Tap label="Finish" onClick={() => post({ action: "script", name: `ss${s.n}-finish` })} />
                  <Tap label="Cancel" onClick={() => post({ action: "script", name: `ss${s.n}-cancel` })} />
                </div>
              </div>
            ))}
          </div>

          <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 pt-2">
            Fake packets for car #{data.sim.selectedCar} (arm alerts first or they go nowhere)
          </div>
          <div className="flex flex-wrap gap-2">
            {INJECTS.map(([id, label]) => (
              <Tap key={id} label={label} onClick={() => post({ action: "inject", inject: id, car: data.sim.selectedCar })} />
            ))}
          </div>
          <div className="text-sm font-mono text-neutral-400">
            {data.overall.stages.slice(0, 8).map((s) => `${s.name}:${s.status}`).join(" · ")}
          </div>
          <div className="text-sm space-y-1 max-h-64 overflow-auto font-mono">
            {data.overall.standings.map((s) => (
              <div key={s.number}>
                {s.number} {s.driverName} {s.isRetired ? "DNF" : `${(s.totalMs / 1000).toFixed(1)}s`}
              </div>
            ))}
          </div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 pt-2">National field — tap to select (gold = alerts). {entriesSeed.length} cars</div>
          <div className="flex flex-wrap gap-1">
            {(entriesSeed as { number: string; driver: string; carClass: string }[]).map((e) => {
              const watching = data.sim.selectedCars?.length ? data.sim.selectedCars : [data.sim.selectedCar];
              const on = watching.includes(e.number);
              return (
              <Tap
                key={e.number}
                gold={on}
                label={`#${e.number} ${e.carClass}`}
                onClick={() => {
                  const next = on ? watching.filter((n) => n !== e.number) : [...watching, e.number];
                  post({ action: "cursor", ...data.sim, selectedCar: e.number, selectedCars: next });
                }}
              />
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#11151c] p-4 space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Event config — bulletin + service times</div>
          <p className="text-xs text-neutral-400">
            Paste the Sportity bulletin URL for the live event (drives the bulletin scanner and Telegram
            alerts). Then paste the service durations from the schedule, comma-separated — e.g.
            <span className="text-brand-gold font-mono">60,60,30</span> = service 1: 60min, 2: 60min, 3: 30min.
          </p>
          <input
            className="w-full bg-[#0a0e14] border border-white/10 rounded px-3 py-2 text-base"
            value={bulletinUrl}
            onChange={(e) => setBulletinUrl(e.target.value)}
            placeholder="Bulletin URL (Sportity)"
          />
          <input
            className="w-full bg-[#0a0e14] border border-white/10 rounded px-3 py-2 text-base"
            value={serviceDurationsCsv}
            onChange={(e) => setServiceDurationsCsv(e.target.value)}
            placeholder="Service durations, e.g. 60,60,30"
          />
          <Tap
            gold
            label="Save event config"
            onClick={() => post({ action: "event-config", bulletinUrl, serviceDurationsCsv })}
          />
        </section>

        <section className="rounded-xl border border-white/10 bg-[#11151c] p-4 space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Friends who can gamble</div>
          <div className="flex flex-wrap gap-2">
            {data.users.map((u) => (
              <label key={u.id} className="text-sm flex items-center gap-1 border border-white/10 rounded-full px-3 py-1">
                <input type="checkbox" checked={gamble.includes(u.id)} onChange={(e) => setGamble((g) => (e.target.checked ? [...g, u.id] : g.filter((id) => id !== u.id)))} />
                {u.username_display}
              </label>
            ))}
          </div>
          <Tap gold label="Save gamble list" onClick={() => post({ action: "gamble", userIds: gamble })} />
        </section>

        <section className="rounded-xl border border-white/10 bg-[#11151c] p-4 space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Users — edit username, email, phone, password</div>
          <input className="w-full bg-[#0a0e14] border border-white/10 rounded px-3 py-2 text-base" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
          <div className="space-y-3">
            {users.map((u) => {
              const e = edit[u.id] ?? { username: u.username_display, email: u.email || "", phone: u.phone || "", password: "" };
              return (
                <div key={u.id} className="rounded-lg border border-white/10 p-3 space-y-2">
                  <div className="text-sm">
                    <span className="font-mono">{u.username_display}</span> · {u.role} · gamble {u.can_gamble ? "yes" : "no"} · poker {u.poker_wins}-{u.poker_losses}
                    {u.role === "admin" ? <span className="text-brand-gold"> · ADMIN</span> : null}
                    <div className={`text-xs ${u.banned ? "text-red-400" : "text-neutral-500"}`}>
                      {u.banned ? "BANNED · " : ""}last login {u.last_login_at ? new Date(Number(u.last_login_at)).toLocaleString() : "never"} · {u.country || "no flag"}
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <input className="bg-[#0a0e14] border border-white/10 rounded px-2 py-2 text-base" value={e.username} onChange={(ev) => setEdit((x) => ({ ...x, [u.id]: { ...e, username: ev.target.value } }))} placeholder="Username" />
                    <input className="bg-[#0a0e14] border border-white/10 rounded px-2 py-2 text-base" value={e.email} onChange={(ev) => setEdit((x) => ({ ...x, [u.id]: { ...e, email: ev.target.value } }))} placeholder="Email" />
                    <input className="bg-[#0a0e14] border border-white/10 rounded px-2 py-2 text-base" value={e.phone} onChange={(ev) => setEdit((x) => ({ ...x, [u.id]: { ...e, phone: ev.target.value } }))} placeholder="Phone" />
                    <input className="bg-[#0a0e14] border border-white/10 rounded px-2 py-2 text-base" type={showPass[u.id] ? "text" : "password"} value={e.password} onChange={(ev) => setEdit((x) => ({ ...x, [u.id]: { ...e, password: ev.target.value } }))} placeholder="New password" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                  <Tap
                    gold
                    label="Save account"
                    onClick={() =>
                      post({
                        action: "user",
                        userId: u.id,
                        username: e.username,
                        email: e.email,
                        phone: e.phone,
                        password: e.password,
                      })
                    }
                  />
                  <Tap
                    label={showPass[u.id] ? "Hide password" : "Show password"}
                    onClick={() => setShowPass((s) => ({ ...s, [u.id]: !s[u.id] }))}
                  />
                  <Tap
                    label={u.banned ? "Unban" : "Ban"}
                    onClick={() => post({ action: u.banned ? "unban" : "ban", userId: u.id })}
                  />
                  <Tap
                    gold={u.role === "admin"}
                    label={u.role === "admin" ? "Remove admin" : "Make admin"}
                    onClick={() => post({ action: "admin", userId: u.id, admin: u.role !== "admin" })}
                  />
                  <Tap label="Remove account" onClick={() => post({ action: "remove", userId: u.id })} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#11151c] p-4 space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Packets / irregularities</div>
          <div className="h-56 overflow-y-auto rounded-md border border-white/10 bg-black/30 p-2 space-y-1">
            {data.irregularities.length === 0 && <p className="text-sm text-neutral-500">None yet.</p>}
            {data.irregularities.map((r, i) => (
              <div key={`${r.t}-${i}`} className="text-xs font-mono text-neutral-400">
                {new Date(Number(r.t)).toISOString()} · {r.severity} · {r.source} · {r.message}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

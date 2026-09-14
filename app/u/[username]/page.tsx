"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { ProfileStats } from "@/lib/cloud";
import type { EwrcProfile } from "@/lib/ewrc";
import { EwrcProfileBody } from "@/components/EwrcProfileBody";

function fmt(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function PublicProfilePage() {
  const params = useParams<{ username: string }>();
  const [state, setState] = useState<
    | { status: "load" }
    | { status: "missing" }
    | {
        status: "ok";
        username: string;
        stats: ProfileStats;
        poker?: string;
        ewrc: EwrcProfile | null;
        bio: string | null;
      }
  >({ status: "load" });

  useEffect(() => {
    const name = params.username;
    if (!name) return;
    fetch(`/api/users/${encodeURIComponent(name)}`)
      .then(async (r) => {
        if (!r.ok) {
          setState({ status: "missing" });
          return;
        }
        const d = await r.json();
        setState({
          status: "ok",
          username: d.username,
          stats: d.stats,
          poker:
            d.canGamble || d.pokerWins + d.pokerLosses > 0
              ? `${d.pokerWins} wins / ${d.pokerLosses} losses`
              : undefined,
          ewrc: d.ewrc ?? null,
          bio: d.bio ?? null,
        });
      })
      .catch(() => setState({ status: "missing" }));
  }, [params.username]);

  return (
    <div
      className="min-h-[calc(100dvh-49px)] bg-[#0a0e14] text-neutral-100"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 7px)",
      }}
    >
      <div className="border-b border-white/10 bg-brand-maroon px-4 py-3">
        <span className="text-xs font-mono uppercase tracking-widest text-white font-bold">Profile</span>
      </div>
      {state.status === "load" && <p className="p-4 text-neutral-500 text-sm">Loading…</p>}
      {state.status === "missing" && <p className="p-4 text-neutral-400">No user by that name.</p>}
      {state.status === "ok" &&
        (state.ewrc ? (
          <EwrcProfileBody
            profile={state.ewrc}
            fallbackName={state.username}
            description={state.bio}
            extra={
              <section>
                <h2 className="font-[family-name:var(--font-display)] text-brand-gold text-xl mb-3">Paranoia</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    { label: "Paranoid username", value: state.username },
                    { label: "Member since", value: fmt(state.stats.memberSince) },
                    { label: "Current rally", value: state.stats.currentRally },
                    { label: "Rallies followed", value: String(state.stats.ralliesFollowed) },
                    { label: "Unique cars followed", value: String(state.stats.uniqueCars) },
                    { label: "Most tracked crew", value: state.stats.mostTrackedCrew },
                    { label: "Class they follow most", value: state.stats.favoriteClass },
                    ...(state.poker ? [{ label: "Poker", value: state.poker }] : []),
                  ].map((c) => (
                    <div key={c.label} className="rounded-xl border border-white/10 bg-[#11151c] p-4">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">{c.label}</div>
                      <div className="mt-1">{c.value}</div>
                    </div>
                  ))}
                </div>
              </section>
            }
          />
        ) : (
          <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
            <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl leading-none tracking-tight">
              {state.username}
            </h1>
            {[
              { label: "Member since", value: fmt(state.stats.memberSince) },
              { label: "Current rally", value: state.stats.currentRally },
              { label: "Rallies followed", value: String(state.stats.ralliesFollowed) },
              { label: "Unique cars followed", value: String(state.stats.uniqueCars) },
              { label: "Most tracked crew", value: state.stats.mostTrackedCrew },
              { label: "Class they follow most", value: state.stats.favoriteClass },
              ...(state.poker ? [{ label: "Poker", value: state.poker }] : []),
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-white/10 bg-[#11151c] p-4">
                <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">{c.label}</div>
                <div className="mt-1">{c.value}</div>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

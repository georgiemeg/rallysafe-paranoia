"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProfileStats } from "@/lib/cloud";
import type { EwrcProfile } from "@/lib/ewrc";
import { EwrcProfileBody } from "@/components/EwrcProfileBody";

function fmt(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function ProfilePage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [poker, setPoker] = useState<{ wins: number; losses: number; show: boolean } | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [ewrc, setEwrc] = useState<EwrcProfile | null>(null);
  const [bio, setBio] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) router.push("/login");
        else {
          setUsername(d.user.username);
          setPoker({
            wins: d.user.pokerWins,
            losses: d.user.pokerLosses,
            show: d.user.canGamble || d.user.pokerWins + d.user.pokerLosses > 0,
          });
          setStats(d.stats);
          setEwrc(d.ewrc ?? null);
          setBio(d.user.bio ?? "");
        }
      });
  }, [router]);

  if (!stats) return <div className="min-h-[calc(100dvh-49px)] bg-[#0a0e14]" />;

  const cards = [
    { label: "Paranoid username", value: username },
    { label: "Member since", value: fmt(stats.memberSince) },
    { label: "Last login", value: stats.lastLoginAt ? new Date(stats.lastLoginAt).toLocaleString() : "—" },
    { label: "Current rally", value: stats.currentRally },
    { label: "Cars this rally", value: String(stats.carsThisRally) },
    { label: "Rallies followed", value: String(stats.ralliesFollowed) },
    { label: "Unique cars followed", value: String(stats.uniqueCars) },
    { label: "Most tracked crew", value: stats.mostTrackedCrew },
    { label: "Class you follow most", value: stats.favoriteClass },
    { label: "Alerts armed", value: stats.alertsArmed },
    ...(poker?.show ? [{ label: "Poker", value: `${poker.wins} wins / ${poker.losses} losses` }] : []),
  ];

  const extra = (
    <section>
      <h2 className="font-[family-name:var(--font-display)] text-brand-gold text-xl mb-3">Paranoia</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-white/10 bg-[#11151c] p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">{c.label}</div>
            <div className="mt-1 text-neutral-100">{c.value}</div>
          </div>
        ))}
      </div>
    </section>
  );

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
      {ewrc ? (
        <EwrcProfileBody profile={ewrc} fallbackName={username} description={bio} extra={extra} />
      ) : (
        <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
          <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl leading-none tracking-tight">
            {username}
          </h1>
          <p className="text-sm text-neutral-400">Filled in when you Save & Start Tracking while logged in.</p>
          {extra}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import type { EwrcProfile } from "@/lib/ewrc";

function SafeImg({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [hide, setHide] = useState(false);
  if (hide || !src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} onError={() => setHide(true)} />
  );
}

function fmtDate(raw: string) {
  if (!raw) return "";
  if (/^\d{4}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function EwrcProfileBody({
  profile,
  fallbackName,
  description,
  extra,
}: {
  profile: EwrcProfile;
  fallbackName?: string;
  description?: string | null;
  extra?: ReactNode;
}) {
  const name = profile.name || fallbackName || "Crew";
  const slug = profile.slug ? `-${profile.slug}` : "";
  const ewrc =
    profile.kind === "codriver"
      ? `https://ewrc-results.com/coprofile/${profile.id}${slug}`
      : `https://ewrc-results.com/profile/${profile.id}${slug}`;
  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row gap-5 items-start">
        {profile.photoUrl && (
          <div className="shrink-0 p-1 bg-brand-gold rounded-sm shadow-[6px_6px_0_#960200]">
            <SafeImg src={profile.photoUrl} alt="" className="w-40 h-40 sm:w-52 sm:h-52 object-cover" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="inline-block max-w-full">
            <div className="flex items-center gap-3">
              <h1 className="font-[family-name:var(--font-display)] text-4xl sm:text-5xl leading-none tracking-tight min-w-0">
                {name}
              </h1>
              {profile.flagUrl && (
                <SafeImg
                  src={profile.flagUrl}
                  alt=""
                  className="h-7 w-10 object-cover rounded-sm border border-white/20 shrink-0"
                />
              )}
            </div>
            {description ? (
              <p className="mt-2 text-sm text-neutral-300 leading-snug whitespace-pre-wrap break-words">{description}</p>
            ) : null}
          </div>
          <div className="rounded-xl border border-white/10 bg-[#11151c] p-4 space-y-2 text-sm">
            {profile.country && (
              <p>
                <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Country </span>
                {profile.country}
              </p>
            )}
            {profile.age != null && (
              <p>
                <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Age </span>
                {profile.age}
                {profile.born ? ` · born ${profile.born}` : ""}
              </p>
            )}
            {profile.starts != null && (
              <p>
                <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Starts </span>
                {profile.starts}
                {profile.seasons ? ` · ${profile.seasons}` : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-4 pt-1 font-mono text-lg">
              <span className="flex items-center gap-2">
                <span aria-hidden>👑</span>
                <span className="text-brand-gold">— {profile.overallWins}</span>
                <span className="text-[10px] uppercase tracking-widest text-neutral-500">overall wins</span>
              </span>
              <span className="flex items-center gap-2">
                <span aria-hidden>🏆</span>
                <span className="text-brand-gold">— {profile.classWins}</span>
                <span className="text-[10px] uppercase tracking-widest text-neutral-500">class wins</span>
              </span>
            </div>
            {profile.titles.length > 0 && (
              <p className="text-neutral-400 text-xs">Titles: {profile.titles.slice(0, 8).join(" · ")}</p>
            )}
            {profile.bio && <p className="text-neutral-300 leading-snug">{profile.bio}</p>}
          </div>
        </div>
      </div>

      {profile.lastResults.length > 0 && (
        <section>
          <h2 className="font-[family-name:var(--font-display)] text-brand-gold text-xl mb-3">Last 10</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {profile.lastResults.map((r) => (
              <div key={r.eventId} className="rounded-xl border border-white/10 bg-[#11151c] overflow-hidden flex gap-3 p-2">
                <div className="w-24 h-24 shrink-0 bg-black/40 overflow-hidden rounded-md">
                  {r.photoUrl ? (
                    <SafeImg src={r.photoUrl} alt="" className="w-full h-full object-cover" />
                  ) : r.flagUrl ? (
                    <SafeImg src={r.flagUrl} alt="" className="w-full h-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1 py-1 pr-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{r.name}</div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                        {fmtDate(r.date)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 text-lg">
                      {r.wonClass && <span title="Won class">🏆</span>}
                      {r.wonOverall && <span title="Won overall">👑</span>}
                      {r.flagUrl && <SafeImg src={r.flagUrl} alt="" className="h-4 w-6 object-cover rounded-sm" />}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-neutral-300 flex items-center gap-2">
                    {r.carLogo && <SafeImg src={r.carLogo} alt="" className="h-4 w-auto max-w-[48px] object-contain" />}
                    <span className="truncate">{r.car || "—"}</span>
                  </div>
                  <div className="mt-1 text-[11px] font-mono uppercase tracking-widest text-neutral-400">
                    Overall {r.overall ?? "—"}
                    {r.className ? ` · ${r.className} ${r.classPos ?? "—"}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {profile.gallery.length > 0 && (
        <section>
          <h2 className="font-[family-name:var(--font-display)] text-brand-gold text-xl mb-3">Photos</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {profile.gallery.map((src) => (
              <div key={src} className="p-1 bg-brand-gold shadow-[4px_4px_0_#960200]">
                <SafeImg src={src} alt="" className="w-full h-40 sm:h-52 object-cover" />
              </div>
            ))}
          </div>
        </section>
      )}

      {extra}

      <a
        href={ewrc}
        target="_blank"
        rel="noreferrer"
        className="block max-w-sm text-center bg-brand-gold text-brand-ink font-mono font-bold rounded-full py-3 uppercase tracking-widest text-sm"
      >
        Open on eWRC
      </a>
    </div>
  );
}

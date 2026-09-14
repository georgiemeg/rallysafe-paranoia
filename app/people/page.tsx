"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { EwrcProfile } from "@/lib/ewrc";
import { EwrcProfileBody } from "@/components/EwrcProfileBody";

function PeopleInner() {
  const sp = useSearchParams();
  const kind = sp.get("kind") === "codriver" ? "codriver" : "driver";
  const id = sp.get("ewrcId") ?? "";
  const fallbackName = sp.get("name") ?? "";
  const [profile, setProfile] = useState<EwrcProfile | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!id) {
      setMissing(true);
      return;
    }
    fetch(`/api/ewrc/person?kind=${kind}&id=${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (!r.ok) {
          setMissing(true);
          return;
        }
        const d = await r.json();
        setProfile(d.profile);
      })
      .catch(() => setMissing(true));
  }, [kind, id]);

  const label = kind === "codriver" ? "Co-driver" : "Driver";

  return (
    <div
      className="min-h-[calc(100dvh-49px)] bg-[#0a0e14] text-neutral-100"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 7px)",
      }}
    >
      <div className="border-b border-white/10 bg-brand-maroon px-4 py-3">
        <span className="text-xs font-mono uppercase tracking-widest text-white font-bold">{label}</span>
      </div>
      {!profile && !missing && <p className="p-4 text-sm text-neutral-500">Loading eWRC…</p>}
      {missing && !profile && <p className="p-4 text-sm text-neutral-400">No extra eWRC page for this name.</p>}
      {profile && <EwrcProfileBody profile={profile} fallbackName={fallbackName} />}
    </div>
  );
}

export default function PeoplePage() {
  return (
    <Suspense fallback={<div className="min-h-[calc(100dvh-49px)] bg-[#0a0e14]" />}>
      <PeopleInner />
    </Suspense>
  );
}

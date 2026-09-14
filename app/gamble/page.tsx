"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Overlay =
  | { kind: "lose"; email: string; username: string; losses: number }
  | { kind: "win-first" }
  | { kind: "win-again" };

export default function GamblePage() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [src, setSrc] = useState("");
  const [block, setBlock] = useState("");
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [rick, setRick] = useState(false);
  const locked = useRef(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) {
          router.push("/login");
          return;
        }
        if (!d.user.canGamble) {
          setBlock("This table is friends-only.");
          return;
        }
        setSrc(`/poker/index.html?name=${encodeURIComponent(d.user.username)}&fresh=${Date.now()}`);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => {
    const onMsg = async (ev: MessageEvent) => {
      if (ev.data?.type !== "paranoia-poker") return;
      if (locked.current) return;
      locked.current = true;
      const win = ev.data.win === true;
      const res = await fetch("/api/auth/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "poker", result: win ? "win" : "loss" }),
      });
      const data = await res.json().catch(() => ({}));
      if (win) {
        window.dispatchEvent(new Event("paranoia-poker"));
        if (data.firstWin) setOverlay({ kind: "win-first" });
        else setOverlay({ kind: "win-again" });
      } else {
        setOverlay({
          kind: "lose",
          email: data.ownerEmail || "",
          username: data.username || "",
          losses: data.pokerLosses || 1,
        });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    if (!overlay) return;
    if (overlay.kind === "lose") {
      const t = window.setTimeout(() => setRick(true), 4000);
      return () => window.clearTimeout(t);
    }
    if (overlay.kind === "win-first") {
      const t = window.setTimeout(() => setOverlay(null), 4000);
      return () => window.clearTimeout(t);
    }
    if (overlay.kind === "win-again") {
      const t = window.setTimeout(() => routerRef.current.push("/"), 5000);
      return () => window.clearTimeout(t);
    }
  }, [overlay]);

  const mailto = (o: Extract<Overlay, { kind: "lose" }>) => {
    if (!o.email) return "";
    const subject = encodeURIComponent(`${o.username} lost at poker!`);
    const body = encodeURIComponent(
      `You're awesome. I lost at Paranoia poker at ${new Date().toLocaleString()}. Total losses: ${o.losses}.`
    );
    return `mailto:${o.email}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="min-h-[calc(100dvh-49px)] bg-[#0a0e14] text-neutral-100 flex flex-col">
      <div className="border-b border-white/10 bg-brand-maroon px-4 py-3 flex items-center gap-3">
        <span className="text-xs font-mono uppercase tracking-widest text-white font-bold">Gamble</span>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="ml-auto text-xs font-mono uppercase tracking-widest text-white/80 hover:text-white"
        >
          Close
        </button>
      </div>
      {block ? (
        <p className="p-6 text-neutral-400">{block}</p>
      ) : src ? (
        <div className="flex-1 min-h-[calc(100dvh-90px)] flex items-center justify-center bg-[#1b2a4a]">
          <iframe title="Poker" src={src} className="w-full max-w-[520px] h-full min-h-[calc(100dvh-90px)] border-0 bg-[#1b2a4a]" />
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {overlay && (
        <div className={`fixed inset-0 z-[200] flex flex-col items-center justify-center p-6 ${rick ? "bg-black" : "bg-neutral-800/95 text-white grayscale"}`}>
          {overlay.kind === "lose" && !rick && (
            <p className="font-[family-name:var(--font-display)] text-6xl sm:text-8xl tracking-tight text-white">YOU LOSE</p>
          )}
          {overlay.kind === "lose" && rick && (
            <div className="w-full max-w-4xl space-y-4">
              <iframe
                title="Never Gonna Give You Up"
                className="w-full aspect-video bg-black"
                src="https://archive.org/embed/Rick_Astley_Never_Gonna_Give_You_Up?autoplay=1"
                allow="autoplay; fullscreen; encrypted-media"
                allowFullScreen
              />
              {overlay.email ? (
                <a className="block text-center text-sm underline text-neutral-200" href={mailto(overlay)}>
                  email the owner instead
                </a>
              ) : null}
            </div>
          )}
          {overlay.kind === "win-first" && (
            <p className="font-[family-name:var(--font-display)] text-6xl sm:text-8xl tracking-tight">You win!!!</p>
          )}
          {overlay.kind === "win-again" && (
            <p className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl tracking-tight text-center max-w-3xl">
              Don&apos;t you have something better to do?
            </p>
          )}
        </div>
      )}
    </div>
  );
}

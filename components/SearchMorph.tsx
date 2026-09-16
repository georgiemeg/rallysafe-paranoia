"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { initials } from "@/lib/person";

type Hit = {
  id: string;
  kind: "user" | "driver" | "codriver";
  label: string;
  sub: string;
  href: string;
  country: string;
  age: number | null;
  photoUrl: string | null;
  description?: string;
};

const KIND: Record<Hit["kind"], string> = {
  user: "User",
  driver: "Driver",
  codriver: "Co-driver",
};

function Avatar({ name, src }: { name: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className="w-11 h-11 rounded-full object-cover shrink-0 bg-[#0a0e14]"
      />
    );
  }
  return (
    <div className="w-11 h-11 rounded-full shrink-0 bg-brand-maroon text-white flex items-center justify-center text-xs font-mono font-bold">
      {initials(name)}
    </div>
  );
}

export function SearchMorph() {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = wrap.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, 280);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      setMenuPos({ left, top: r.bottom + 8, width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, hits.length]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
        setHits([]);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQ("");
        setHits([]);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    if (trimmed.length < 1) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.hits)) {
          setHits(data.hits);
          setActive(0);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }, 120);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  const go = (hit?: Hit) => {
    const target = hit ?? hits[active];
    if (!target) return;
    setOpen(false);
    setQ("");
    setHits([]);
    router.push(target.href);
  };

  return (
    <div ref={wrap} className="relative flex items-center shrink-0">
      <div
        className={`flex items-center overflow-hidden border transition-[width,background-color,border-radius] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-within:border-brand-gold/60 ${
          open
            ? "w-[min(18rem,calc(100vw-8rem))] sm:w-72 rounded-full bg-[#11151c] border-white/20"
            : "w-10 rounded-full bg-transparent border-white/20 hover:border-white/40"
        }`}
      >
        <button
          type="button"
          aria-label="Search"
          className="shrink-0 w-10 h-10 flex items-center justify-center text-neutral-300 hover:text-white"
          onClick={() => setOpen(true)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M20 20L16.5 16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go();
            }
          }}
          placeholder="Users · eWRC people"
          className={`bg-transparent outline-none text-sm text-neutral-100 placeholder:text-neutral-500 h-10 pr-3 min-w-0 flex-1 transition-opacity duration-200 ${
            open ? "opacity-100" : "opacity-0 pointer-events-none w-0"
          }`}
        />
      </div>

      {open && hits.length > 0 && menuPos && (
        <div
          className="z-[80] space-y-2 max-h-[70vh] overflow-y-auto"
          style={{
            position: "fixed",
            left: menuPos.left,
            top: menuPos.top,
            width: menuPos.width,
          }}
        >
          {hits.map((h, i) => (
            <button
              key={h.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => go(h)}
              className={`w-full text-left rounded-xl border p-2.5 flex items-center gap-3 ${
                i === active
                  ? "bg-[#11151c] border-brand-gold/50"
                  : "bg-[#11151c] border-white/10 hover:border-white/25"
              }`}
            >
              <Avatar name={h.label} src={h.photoUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-neutral-100 truncate">{h.label}</span>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-brand-gold shrink-0">
                    {KIND[h.kind]}
                  </span>
                </div>
                <div className="text-[11px] text-neutral-400 truncate">
                  {[h.country || null, h.age != null ? `${h.age}` : null].filter(Boolean).join(" · ") || "—"}
                </div>
                {h.description || h.sub ? (
                  <div className="text-[11px] text-neutral-500 truncate">{h.description || h.sub}</div>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

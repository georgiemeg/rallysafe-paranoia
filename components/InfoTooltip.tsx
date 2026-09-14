"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pointed bubble anchored to the ⓘ. Hover on fine pointers; tap to toggle on
 * touch. Flips if it would overflow the viewport. Never window.alert / toast.
 */
export function InfoTooltip({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const leaveTimer = useRef<number | null>(null);

  const cancelLeave = () => {
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };

  const scheduleLeave = () => {
    cancelLeave();
    leaveTimer.current = window.setTimeout(() => setOpen(false), 150);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const btn = wrapRef.current;
    const bubble = bubbleRef.current;
    if (!btn || !bubble) return;
    const br = btn.getBoundingClientRect();
    const bw = Math.min(260, window.innerWidth - 16);
    let left = br.left + br.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    const spaceBelow = window.innerHeight - br.bottom;
    const placeAbove = spaceBelow < 120 && br.top > spaceBelow;
    bubble.style.width = `${bw}px`;
    bubble.style.left = `${left}px`;
    if (placeAbove) {
      bubble.style.top = "auto";
      bubble.style.bottom = `${window.innerHeight - br.top + 8}px`;
      bubble.dataset.side = "above";
    } else {
      bubble.style.bottom = "auto";
      bubble.style.top = `${br.bottom + 8}px`;
      bubble.dataset.side = "below";
    }
    const caretX = br.left + br.width / 2 - left;
    bubble.style.setProperty("--caret-x", `${caretX}px`);
  }, [open, text]);

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => {
        cancelLeave();
        setOpen(true);
      }}
      onMouseLeave={scheduleLeave}
    >
      <button
        type="button"
        aria-label="More info"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onFocus={() => setOpen(true)}
        className="flex items-center justify-center w-4 h-4 rounded-full border border-current text-[10px] leading-none opacity-60 hover:opacity-100 transition-opacity shrink-0"
      >
        i
      </button>
      {open && (
        <span
          ref={bubbleRef}
          role="tooltip"
          className="info-tip-bubble fixed z-[80] rounded-lg bg-brand-ink border border-white/15 text-neutral-200 text-xs leading-snug px-3 py-2 shadow-xl shadow-black/50"
        >
          {text}
        </span>
      )}
    </span>
  );
}

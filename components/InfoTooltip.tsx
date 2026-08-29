"use client";

import { useState } from "react";

/**
 * Small circular "i" info icon. Hovering (desktop) or tapping (mobile, since hover doesn't
 * exist there) reveals a floating tooltip with an explanation. Built per Helen's eval
 * feedback: "every feature has to have an explanation... I think scroll-over is easier
 * because it doesn't require [navigating to] another page and reduces misclicking."
 */
export function InfoTooltip({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="More info"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex items-center justify-center w-4 h-4 rounded-full border border-current text-[10px] leading-none opacity-60 hover:opacity-100 transition-opacity shrink-0"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-50 left-1/2 -translate-x-1/2 bottom-[130%] w-56 rounded-lg bg-brand-ink border border-white/15 text-neutral-200 text-xs leading-snug px-3 py-2 shadow-xl shadow-black/50 pointer-events-none"
        >
          {text}
          <span className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-brand-ink border-r border-b border-white/15 rotate-45 -mt-1" />
        </span>
      )}
    </span>
  );
}

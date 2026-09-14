"use client";

import { useEffect, useState } from "react";

export type ShellMode = "desktop" | "compact-desktop" | "mobile";

export interface Shell {
  mode: ShellMode;
  isMobile: boolean;
  canHover: boolean;
  allowIframeEmbed: boolean;
  isCompactWidth: boolean;
}

/**
 * Ticket A/B: never treat a windowed desktop browser as a phone.
 * Mobile page files load only on a coarse pointer (real phone/tablet).
 * Width < 640 on a mouse still uses desktop files (compact-desktop).
 */
export function useShell(): Shell | null {
  const [shell, setShell] = useState<Shell | null>(null);

  useEffect(() => {
    const coarseMq = window.matchMedia("(hover: none) and (pointer: coarse)");
    const hoverMq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const compactMq = window.matchMedia("(max-width: 639px)");
    const midMq = window.matchMedia("(max-width: 1023px)");

    const sync = () => {
      const isCoarse = coarseMq.matches;
      const canHover = hoverMq.matches;
      const isCompactWidth = compactMq.matches;
      const mode: ShellMode = isCoarse
        ? "mobile"
        : isCompactWidth || midMq.matches
          ? "compact-desktop"
          : "desktop";
      setShell({
        mode,
        isMobile: isCoarse,
        canHover,
        allowIframeEmbed: !isCoarse,
        isCompactWidth,
      });
    };

    sync();
    coarseMq.addEventListener("change", sync);
    hoverMq.addEventListener("change", sync);
    compactMq.addEventListener("change", sync);
    midMq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      coarseMq.removeEventListener("change", sync);
      hoverMq.removeEventListener("change", sync);
      compactMq.removeEventListener("change", sync);
      midMq.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  return shell;
}

/** Back-compat: true only on a real phone, never on a skinny desktop window. */
export function useNarrow(): boolean | null {
  const shell = useShell();
  if (shell === null) return null;
  return shell.isMobile;
}

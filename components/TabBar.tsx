"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShell } from "@/lib/useNarrow";
import { AuthMenu } from "@/components/AuthMenu";
import { SearchMorph } from "@/components/SearchMorph";

const TABS = [
  { href: "/", label: "Home", live: false, path: housePath },
  { href: "/live", label: "RallySafe Live", live: true, path: radioPath },
  { href: "/results", label: "Results", live: false, path: flagPath },
  { href: "/help", label: "Help", live: false, path: helpPath },
];

function housePath() {
  return <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5Z" />;
}
function radioPath() {
  return (
    <>
      <circle cx="12" cy="13" r="2.2" />
      <path d="M8.2 9.2a6 6 0 0 1 7.6 0M6 7a9 9 0 0 1 12 0" />
    </>
  );
}
function flagPath() {
  return <path d="M5 21V4h.5l.8 1H19l-1.2 4.2L19 13H6.3" />;
}
function helpPath() {
  return (
    <>
      <path d="M9.2 9a3 3 0 1 1 4.3 2.7c-.8.4-1.5 1-1.5 2v.4" />
      <circle cx="12" cy="17.5" r=".9" fill="currentColor" stroke="none" />
    </>
  );
}

const BTN =
  "shrink-0 h-10 min-w-10 px-0 flex items-center justify-center rounded-full text-center font-mono uppercase tracking-widest transition-colors";
const LABEL_BTN = "sm:px-5 px-3 gap-1.5";

export function TabBar() {
  const pathname = usePathname();
  const shell = useShell();
  const iconsOnly = !shell || shell.mode !== "desktop";
  const tabs = TABS.filter((tab) => !tab.live || shell?.mode === "desktop");

  return (
    <nav className="sticky top-0 z-40 w-full overflow-visible border-b border-white/10 bg-[#0a0e14]/95 backdrop-blur supports-[backdrop-filter]:bg-[#0a0e14]/80">
      <div className="flex items-center h-12 w-full gap-1 px-2">
        <div className="flex items-center gap-1 min-w-0">
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                title={tab.label}
                aria-label={tab.label}
                className={`${BTN} ${iconsOnly ? "" : LABEL_BTN} ${
                  active
                    ? `${tab.href === "/" ? "bg-brand-gold text-brand-ink" : tab.href === "/live" ? "bg-brand-golden-orange text-white" : tab.href === "/results" ? "bg-brand-teal text-white" : "bg-neutral-300 text-brand-ink"} font-bold shadow-lg`
                    : "text-neutral-400 hover:text-neutral-100 hover:bg-white/5"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden className="block">
                  {tab.path()}
                </svg>
                {!iconsOnly && <span className="text-xs leading-none">{tab.label}</span>}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center shrink-0 gap-1">
          <SearchMorph />
          <AuthMenu compact={iconsOnly} />
        </div>
      </div>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Setup", icon: "\u2699\uFE0F", color: "bg-brand-gold text-brand-ink" },
  { href: "/live", label: "RallySafe Live", icon: "\uD83D\uDCE1", color: "bg-brand-orange text-white" },
  { href: "/results", label: "Results", icon: "\uD83C\uDFC1", color: "bg-brand-teal text-white" },
];

export function TabBar() {
  const pathname = usePathname();
  const isResults = pathname === "/results";

  return (
    <nav
      className={`sticky top-0 z-40 border-b backdrop-blur overflow-hidden ${
        isResults
          ? "border-white/10 bg-[#0a0e14]/95 supports-[backdrop-filter]:bg-[#0a0e14]/80"
          : "border-black/20"
      }`}
      style={
        isResults
          ? undefined
          : {
              backgroundImage:
                "repeating-linear-gradient(45deg, #0a0a0a 0px, #0a0a0a 22px, #D5A021 22px, #D5A021 44px)",
              backgroundSize: "62.23px 62.23px",
            }
      }
    >
      <div className="max-w-6xl mx-auto flex items-stretch gap-1 px-1 py-1">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative flex-1 sm:flex-none sm:px-6 px-2 py-2.5 text-center text-xs sm:text-sm font-mono uppercase tracking-widest transition-colors rounded-full ${
                active
                  ? `${tab.color} font-bold shadow-lg`
                  : isResults
                    ? "text-neutral-500 hover:text-neutral-200 hover:bg-white/5"
                    : "text-white/80 hover:text-white hover:bg-black/20 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
              }`}
            >
              <span className="hidden sm:inline mr-1.5">{tab.icon}</span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

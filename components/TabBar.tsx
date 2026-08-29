"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Setup", icon: "\u2699\uFE0F" },
  { href: "/live", label: "RallySafe Live", icon: "\uD83D\uDCE1" },
  { href: "/results", label: "Results", icon: "\uD83C\uDFC1" },
];

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-40 border-b border-white/10 bg-[#05070c]/95 backdrop-blur supports-[backdrop-filter]:bg-[#05070c]/80">
      <div className="max-w-6xl mx-auto flex items-stretch">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative flex-1 sm:flex-none sm:px-6 px-2 py-3 text-center text-xs sm:text-sm font-mono uppercase tracking-widest transition-colors ${
                active
                  ? "text-brand-gold"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              <span className="hidden sm:inline mr-1.5">{tab.icon}</span>
              {tab.label}
              {active && (
                <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-brand-gold shadow-[0_0_8px_rgba(213,160,33,0.8)]" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

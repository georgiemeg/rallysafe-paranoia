"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { applyStylePalette, pickStylePalette, type StylePalette } from "@/lib/poker-style";

type User = {
  username: string;
  canGamble: boolean;
  styleUnlocked: boolean;
  photoUrl?: string | null;
  role?: string | null;
  isAdmin?: boolean;
};

const ACCOUNT_HREFS = ["/login", "/register", "/settings", "/profile", "/gamble", "/dev"];
const PILL =
  "relative shrink-0 h-10 flex items-center justify-center text-center text-xs font-mono uppercase tracking-widest transition-colors rounded-full leading-none";
const ACTIVE = "bg-brand-maroon text-white font-bold shadow-lg";
const IDLE = "text-neutral-400 hover:text-neutral-100 hover:bg-white/5";

export function AuthMenu({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState<StylePalette | null>(null);
  const onAccount = ACCOUNT_HREFS.some((h) => pathname === h || pathname.startsWith(`${h}/`));

  const loadUser = () =>
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) =>
        setUser(
          d.user
            ? { ...d.user, photoUrl: d.user.photoUrl || d.ewrc?.photoUrl || null }
            : null
        )
      )
      .catch(() => setUser(null));

  useEffect(() => {
    loadUser();
  }, [pathname]);

  useEffect(() => {
    const onPoker = () => loadUser();
    window.addEventListener("paranoia-poker", onPoker);
    return () => window.removeEventListener("paranoia-poker", onPoker);
  }, []);

  if (user === undefined) {
    return <div className={`${PILL} ${compact ? "w-10" : "px-4"} ${IDLE} invisible`}>Login</div>;
  }

  if (!user) {
    return (
      <Link href="/login" className={`${PILL} ${compact ? "w-10" : "px-4"} ${ACTIVE}`} title="Login" aria-label="Login">
        {compact ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="12" cy="8" r="3.2" />
            <path d="M5 19c1.5-3 4-4.5 7-4.5S17.5 16 19 19" />
          </svg>
        ) : (
          "Login"
        )}
      </Link>
    );
  }

  return (
    <div className="flex items-center shrink-0 gap-1">
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={`Profile — ${user.username}`}
          aria-label={`Profile — ${user.username}`}
          className={`${PILL} ${compact ? "w-10 px-0 overflow-hidden" : "px-4"} ${onAccount || open ? ACTIVE : IDLE}`}
        >
          {compact ? (
            user.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.photoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="12" cy="8" r="3.2" />
                <path d="M5 19c1.5-3 4-4.5 7-4.5S17.5 16 19 19" />
              </svg>
            )
          ) : (
            `Hi, ${user.username}!`
          )}
        </button>
        {open && (
          <div className="absolute right-0 left-auto mt-1 w-48 rounded-xl border border-white/10 bg-[#11151c] py-1 z-50 shadow-xl">
            <Link
              href="/settings"
              className="block px-3 py-2 text-xs font-mono uppercase tracking-widest text-neutral-200 hover:bg-white/5"
              onClick={() => setOpen(false)}
            >
              Settings
            </Link>
            {user.isAdmin && (
              <Link
                href="/dev"
                className="block px-3 py-2 text-xs font-mono uppercase tracking-widest text-brand-gold hover:bg-white/5"
                onClick={() => setOpen(false)}
              >
                Dev
              </Link>
            )}
            <Link
              href="/profile"
              className="block px-3 py-2 text-xs font-mono uppercase tracking-widest text-neutral-200 hover:bg-white/5"
              onClick={() => setOpen(false)}
            >
              Profile
            </Link>
            {user.canGamble && (
              <Link
                href="/gamble"
                className="block px-3 py-2 text-xs font-mono uppercase tracking-widest text-neutral-200 hover:bg-white/5"
                onClick={() => setOpen(false)}
              >
                Gamble
              </Link>
            )}
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:bg-white/5"
              onClick={async () => {
                await fetch("/api/auth/me", { method: "POST", credentials: "include" });
                setUser(null);
                setOpen(false);
                router.refresh();
              }}
            >
              Log out
            </button>
          </div>
        )}
      </div>
      {user.styleUnlocked && (
        <button
          type="button"
          title="Style"
          aria-label="Style"
          className={`${PILL} ${compact ? "w-10 px-0" : "px-4"} bg-brand-gold text-brand-ink font-bold shadow-lg`}
          onClick={() => {
            const next = pickStylePalette(palette);
            setPalette(next);
            applyStylePalette(next);
          }}
        >
          {compact ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="8" cy="8" r="3" />
              <circle cx="16" cy="8" r="3" />
              <circle cx="8" cy="16" r="3" />
              <circle cx="16" cy="16" r="3" />
            </svg>
          ) : (
            "Style"
          )}
        </button>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const field =
  "mt-1 w-full bg-[#0a0e14] border border-white/10 rounded-lg px-3 py-2.5 text-base text-neutral-100 placeholder:text-neutral-600";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (!res.ok) {
        setError(data.error ?? "Could not sign in. If you're in Telegram, open this in Safari.");
        return;
      }
      window.location.replace("/");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="min-h-[calc(100dvh-49px)] bg-[#0a0e14] text-neutral-100"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 7px)",
      }}
    >
      <div className="border-b border-white/10 bg-brand-maroon px-4 py-3">
        <span className="text-xs font-mono uppercase tracking-widest text-white font-bold">Login</span>
      </div>

      <form onSubmit={submit} className="max-w-md mx-auto p-4 sm:p-6 space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl leading-none tracking-tight">
          SIGN IN
        </h1>
        <p className="text-sm text-neutral-400">
          Saves your cars across devices. Guest still works if you skip this.
        </p>

        <div className="rounded-xl border border-white/10 bg-[#11151c] p-4 sm:p-5 space-y-4">
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Username</span>
            <input
              className={field}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              name="username"
              inputMode="text"
            />
            <Link href="/settings" className="inline-block mt-1 text-[10px] font-mono uppercase tracking-widest text-brand-gold">
              Request username change
            </Link>
          </label>

          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Password</span>
            <input
              type="password"
              className={field}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <Link href="/settings" className="inline-block mt-1 text-[10px] font-mono uppercase tracking-widest text-brand-gold">
              Request password change
            </Link>
          </label>

          {error && <p className="text-sm text-brand-orange">{error}</p>}

          <button
            disabled={busy}
            className="w-full bg-brand-gold text-brand-ink font-mono font-bold rounded-full py-3 uppercase tracking-widest text-sm disabled:opacity-50"
          >
            Sign in
          </button>
        </div>

        <Link
          href="/register"
          className="block text-center text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-white"
        >
          Create account
        </Link>
      </form>
    </div>
  );
}

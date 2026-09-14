"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const field =
  "mt-1 w-full bg-[#0a0e14] border border-white/10 rounded-lg px-3 py-2.5 text-base text-neutral-100 placeholder:text-neutral-600";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [popup, setPopup] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setPopup("The passwords must match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, confirm, email, phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create account.");
        return;
      }
      setPopup("Account created. Log in to save your cars across devices.");
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
        <span className="text-xs font-mono uppercase tracking-widest text-white font-bold">Create account</span>
      </div>

      <form onSubmit={submit} className="max-w-md mx-auto p-4 sm:p-6 space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl leading-none tracking-tight">
          JOIN UP
        </h1>
        <p className="text-sm text-neutral-400">Username plus a password, and either an email or a phone.</p>

        <div className="rounded-xl border border-white/10 bg-[#11151c] p-4 sm:p-5 space-y-4">
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Username</span>
            <input
              className={field}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Password</span>
            <input
              type="password"
              className={field}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Confirm password</span>
            <input
              type="password"
              className={field}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
              Email — skip if you enter a phone
            </span>
            <input type="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
              Phone — skip if you enter an email
            </span>
            <input className={field} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>

          {error && <p className="text-sm text-brand-orange">{error}</p>}

          <button
            disabled={busy}
            className="w-full bg-brand-gold text-brand-ink font-mono font-bold rounded-full py-3 uppercase tracking-widest text-sm disabled:opacity-50"
          >
            Create account
          </button>
        </div>

        <Link
          href="/login"
          className="block text-center text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-white"
        >
          Already have an account — sign in
        </Link>
      </form>

      {popup && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-brand-gold text-brand-ink rounded-2xl p-6 max-w-sm w-full text-center">
            <p className="font-[family-name:var(--font-display)] text-lg mb-3 leading-tight">{popup}</p>
            <button
              className="bg-brand-ink text-white font-mono uppercase tracking-widest text-xs rounded-full px-4 py-2 w-full"
              onClick={() => {
                setPopup("");
                if (popup.startsWith("Account created")) router.push("/login");
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

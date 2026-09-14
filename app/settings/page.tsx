"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getDeviceId } from "@/lib/device";
import { PhotoCropper } from "@/components/PhotoCropper";
import { flagUrl, regionOptions, toCountryCode } from "@/lib/person";

const BIO_WORDS = 250;

function wordCount(s: string) {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

function clipWords(s: string, n: number) {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= n) return s;
  return parts.slice(0, n).join(" ");
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<{
    username: string;
    email: string | null;
    phone: string | null;
    lastLoginAt: number | null;
    country: string | null;
    birthYear: number | null;
    photoUrl: string | null;
    ewrcId: number | null;
    ewrcKind: string | null;
    ewrcClaimStatus: string | null;
    bio: string | null;
  } | null>(null);
  const [claimQ, setClaimQ] = useState("");
  const [claimHits, setClaimHits] = useState<{ id: string; kind: "driver" | "codriver"; label: string }[]>([]);
  const [claimPick, setClaimPick] = useState<{ kind: "driver" | "codriver"; ewrcId: number; name: string } | null>(null);
  const [country, setCountry] = useState("");
  const [bio, setBio] = useState("");
  const [toast, setToast] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) router.push("/login");
        else {
          setUser(d.user);
          setCountry(toCountryCode(d.user.country) ?? "");
          setBio(d.user.bio ?? "");
          setBirthYear(d.user.birthYear ? String(d.user.birthYear) : "");
          setPhotoUrl(d.user.photoUrl ?? "");
          if (typeof d.prefs?.smsEnabled === "boolean") setSmsEnabled(d.prefs.smsEnabled);
        }
      });
  }, [router]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? "" : t)), 3500);
  };

  const request = async (type: "username" | "password" | "contact" | "delete" | "ewrc-claim", extra?: Record<string, unknown>) => {
    const res = await fetch("/api/auth/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "change-request", type, ...extra }),
    });
    const data = await res.json();
    flash(data.message ?? data.error ?? "Done.");
  };

  const savePrefs = async (next: boolean) => {
    setSmsEnabled(next);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prefs", smsEnabled: next, deviceId: getDeviceId() }),
      });
      const data = await res.json();
      flash(
        data.ok
          ? next
            ? "Texts are on. Inbox still gets every alert."
            : "Texts are off. Alerts still land in the in-app box."
          : (data.error ?? "Could not save.")
      );
    } finally {
      setBusy(false);
    }
  };

  if (!user) return <div className="min-h-[calc(100dvh-49px)] bg-[#0a0e14]" />;

  return (
    <div
      className="min-h-[calc(100dvh-49px)] bg-[#0a0e14] text-neutral-100 relative"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 7px)",
      }}
    >
      {toast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] max-w-sm w-[calc(100%-1.5rem)] rounded-xl border border-brand-gold/40 bg-brand-ink px-4 py-3 text-sm text-center text-white shadow-lg shadow-black/50">
          {toast}
        </div>
      )}
      <div className="border-b border-white/10 bg-brand-maroon px-4 py-3">
        <span className="text-xs font-mono uppercase tracking-widest text-white font-bold">Settings</span>
      </div>

      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl leading-none tracking-tight">
          SETTINGS
        </h1>

        <div className="grid gap-4 sm:grid-cols-2">

        <div className="rounded-xl border border-white/10 bg-[#11151c] p-4 space-y-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Username</div>
            <div className="text-lg">{user.username}</div>
            <button className="text-[10px] font-mono uppercase tracking-widest text-brand-gold mt-1" onClick={() => request("username")}>
              Request to change username
            </button>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Password</div>
            <div className="text-lg">••••••••</div>
            <button className="text-[10px] font-mono uppercase tracking-widest text-brand-gold mt-1" onClick={() => request("password")}>
              Request to change password
            </button>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Contact</div>
            <div className="text-lg">{user.email || user.phone || "—"}</div>
            <button className="text-[10px] font-mono uppercase tracking-widest text-brand-gold mt-1" onClick={() => request("contact")}>
              Request to change contact info
            </button>
          </div>
        </div>

        <form
          className="rounded-xl border border-white/10 bg-[#11151c] p-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const res = await fetch("/api/auth/account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "profile", country, birthYear, bio }),
              });
              const data = await res.json();
              flash(data.ok ? "Saved." : (data.error ?? "Could not save."));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Search card</div>
          <p className="text-sm text-neutral-400">Shows on the magnifying-glass results. Leave blank to hide.</p>
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Flag / country</span>
            <div className="mt-1 flex items-center gap-2">
              {flagUrl(country) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={flagUrl(country)!} alt="" className="h-6 w-9 object-cover rounded-sm border border-white/20" />
              )}
              <select
                className="flex-1 bg-[#0a0e14] border border-white/10 rounded-lg px-3 py-2 text-base"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                <option value="">—</option>
                {regionOptions().map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Description</span>
            <div className="relative mt-1">
              <textarea
                className="w-full bg-[#0a0e14] border border-white/10 rounded-lg px-3 pt-2 pb-7 text-base min-h-[88px]"
                value={bio}
                onChange={(e) => setBio(clipWords(e.target.value, BIO_WORDS))}
                placeholder="A line under your name on the profile"
              />
              <span className="pointer-events-none absolute bottom-2 left-3 text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                {wordCount(bio)} / {BIO_WORDS}
              </span>
            </div>
          </label>
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Birth year</span>
            <input
              className="mt-1 w-full bg-[#0a0e14] border border-white/10 rounded-lg px-3 py-2 text-base"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              placeholder="1998"
              inputMode="numeric"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Profile photo</span>
            <div className="mt-2 flex items-center gap-3">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="" className="w-14 h-14 rounded-sm object-cover border border-brand-gold" />
              ) : (
                <div className="w-14 h-14 rounded-sm bg-[#0a0e14] border border-white/10" />
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="text-sm text-neutral-300 file:mr-3 file:rounded-full file:border-0 file:bg-brand-gold file:text-brand-ink file:font-mono file:text-xs file:uppercase file:tracking-widest file:px-3 file:py-2"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) setCropFile(file);
                }}
              />
              {photoUrl?.includes("/api/users/") && (
                <button
                  type="button"
                  disabled={busy}
                  className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const res = await fetch("/api/auth/account", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "photo-clear" }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        setPhotoUrl(data.photoUrl ?? "");
                        flash("Photo removed. Back to the default.");
                      } else flash(data.error ?? "Could not remove photo.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </label>
          <button
            disabled={busy}
            className="w-full bg-brand-gold text-brand-ink font-mono font-bold rounded-full py-3 uppercase tracking-widest text-sm disabled:opacity-50"
          >
            Save search card
          </button>
        </form>

        <div className="rounded-xl border border-white/10 bg-[#11151c] p-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Text alerts</div>
          <p className="text-sm text-neutral-400 mt-1 mb-3">
            In-app inbox always records alerts. This only turns the actual SMS on or off.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => savePrefs(!smsEnabled)}
            className={`w-full rounded-full py-3 font-mono uppercase tracking-widest text-sm font-bold ${
              smsEnabled ? "bg-brand-gold text-brand-ink" : "bg-brand-maroon text-white"
            }`}
          >
            {smsEnabled ? "Texts on" : "Texts off"}
          </button>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#11151c] p-4 space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Claim eWRC profile</div>
          {user.ewrcClaimStatus === "approved" && user.ewrcId ? (
            <p className="text-sm text-neutral-300">
              Linked as {user.ewrcKind || "driver"} #{user.ewrcId}
            </p>
          ) : user.ewrcClaimStatus === "pending" ? (
            <p className="text-sm text-neutral-400">Claim pending approval.</p>
          ) : (
            <>
              <p className="text-sm text-neutral-400">One profile per account. Request goes through Freddy.</p>
              <input
                className="w-full bg-[#0a0e14] border border-white/10 rounded-lg px-3 py-2 text-base"
                value={claimQ}
                onChange={async (e) => {
                  const v = e.target.value;
                  setClaimQ(v);
                  setClaimPick(null);
                  if (v.trim().length < 3) {
                    setClaimHits([]);
                    return;
                  }
                  const r = await fetch(`/api/search?q=${encodeURIComponent(v.trim())}`);
                  const d = await r.json();
                  setClaimHits(
                    (d.hits ?? []).filter((h: { kind: string }) => h.kind === "driver" || h.kind === "codriver")
                  );
                }}
                placeholder="Search your eWRC name"
              />
              {claimHits.map((h) => {
                const ewrcId = Number(String(h.id).split(":").pop());
                return (
                  <button
                    key={h.id}
                    type="button"
                    className="block w-full text-left text-sm text-neutral-200 hover:text-brand-gold"
                    onClick={() => {
                      setClaimPick({ kind: h.kind, ewrcId, name: h.label });
                      setClaimQ(h.label);
                      setClaimHits([]);
                    }}
                  >
                    {h.label} · {h.kind}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={busy || !claimPick}
                className="w-full bg-brand-gold text-brand-ink font-mono font-bold rounded-full py-3 uppercase tracking-widest text-sm disabled:opacity-50"
                onClick={() => claimPick && request("ewrc-claim", claimPick)}
              >
                Request claim
              </button>
            </>
          )}
        </div>
        </div>

        {user.lastLoginAt && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
            Last login {new Date(user.lastLoginAt).toLocaleString()}
          </p>
        )}

        <button
          className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-brand-maroon"
          onClick={() => request("delete")}
        >
          Request to delete this account
        </button>
      </div>
      {cropFile && (
        <PhotoCropper
          file={cropFile}
          busy={busy}
          onCancel={() => setCropFile(null)}
          onConfirm={async (image) => {
            setBusy(true);
            try {
              const res = await fetch("/api/auth/account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "photo", image }),
              });
              const data = await res.json();
              if (data.ok && data.photoUrl) {
                setPhotoUrl(data.photoUrl);
                setCropFile(null);
                flash("Photo saved. It shows on your profile and in search.");
              } else flash(data.error ?? "Could not save photo.");
            } catch {
              flash("Could not save photo.");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

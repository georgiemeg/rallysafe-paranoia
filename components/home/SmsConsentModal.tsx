"use client";

import Link from "next/link";
import { useState } from "react";

/** Twilio-required SMS consent modal. Pops up right before we send the very first text to
 * a phone number — NOT its own page, since the phone number and car selection are already
 * on the home page by the time this shows. No phone input here on purpose. */
export function SmsConsentModal({
  phone,
  onConfirm,
  onCancel,
  busy,
}: {
  phone: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [checked, setChecked] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[90]">
      <div className="bg-[#11151c] border border-white/10 rounded-2xl p-5 sm:p-6 max-w-sm w-full space-y-4">
        <h2 className="font-[family-name:var(--font-display)] text-xl leading-tight text-neutral-100">
          One quick thing before we text you
        </h2>
        <p className="text-sm text-neutral-400">
          We&apos;ll be sending alerts to <span className="text-neutral-200 font-mono">{phone}</span>. Please
          confirm you want that.
        </p>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-1 w-5 h-5 shrink-0 accent-brand-gold"
          />
          <span className="text-sm text-neutral-200 leading-snug">
            Yes, I would like to receive automated text messages from RallySafe Paranoia with rally stage-time,
            service, and incident alerts for the cars I&apos;m tracking above.
          </span>
        </label>

        <div className="text-xs text-neutral-500 space-y-1.5 border-t border-white/10 pt-3">
          <p>
            <span className="text-neutral-300 font-medium">Message Frequency:</span> Varies with how many cars you
            track and event activity — commonly several messages per hour during a live rally, none between events.
          </p>
          <p>
            <span className="text-neutral-300 font-medium">Standard Rates:</span> Message and data rates may apply.
          </p>
          <p>
            <span className="text-neutral-300 font-medium">Help &amp; Stop:</span> Reply HELP for help or STOP to
            cancel at any time.
          </p>
          <p>
            <Link href="/terms" target="_blank" className="underline hover:text-neutral-300">
              Terms of Service
            </Link>{" "}
            |{" "}
            <Link href="/privacy" target="_blank" className="underline hover:text-neutral-300">
              Privacy Policy
            </Link>
          </p>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 border border-white/10 text-neutral-300 font-mono uppercase tracking-widest text-xs rounded-full px-4 py-3 disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!checked || busy}
            className="flex-1 bg-brand-gold text-brand-ink font-bold rounded-full px-4 py-3 uppercase tracking-widest text-xs disabled:opacity-50"
          >
            {busy ? "Saving…" : "Yes, sign me up!"}
          </button>
        </div>
      </div>
    </div>
  );
}

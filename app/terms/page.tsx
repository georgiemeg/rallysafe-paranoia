import Link from "next/link";

export const metadata = { title: "Terms of Service — RallySafe Paranoia" };

export default function TermsPage() {
  return (
    <div className="min-h-[calc(100dvh-49px)] bg-[#0a0e14] text-neutral-100">
      <div className="border-b border-white/10 bg-brand-maroon px-4 py-3">
        <span className="text-xs font-mono uppercase tracking-widest text-white font-bold">Terms of Service</span>
      </div>
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4 text-sm text-neutral-300 leading-relaxed">
        <p className="text-neutral-500">Last updated: {new Date().toISOString().slice(0, 10)}</p>

        <h2 className="text-neutral-100 font-semibold text-base pt-2">What this is</h2>
        <p>
          RallySafe Paranoia is a personal-use rally tracking tool. It lets you choose specific cars/drivers in a
          rally event and receive text and/or in-app alerts about their stage times, service estimates, and
          incidents (e.g. a car stopped on course).
        </p>

        <h2 className="text-neutral-100 font-semibold text-base pt-2">Text messaging</h2>
        <p>
          If you opt in to text alerts, you may receive automated SMS messages about the cars you&apos;re tracking.
          Message frequency varies with how many cars you track and how active the event is — commonly several
          messages per hour during a live rally, and none when no event is running. Message and data rates may
          apply. Reply HELP for help, STOP to cancel at any time. Wireless carriers are not liable for delayed or
          undelivered messages. Consent to receive texts is not required to use the web app.
        </p>

        <h2 className="text-neutral-100 font-semibold text-base pt-2">No warranty</h2>
        <p>
          Data comes from third-party live rally tracking feeds and results systems. It can be delayed, incomplete,
          or wrong. Do not rely on this tool for safety-critical decisions — always follow official event
          communications and marshal instructions.
        </p>

        <h2 className="text-neutral-100 font-semibold text-base pt-2">Changes</h2>
        <p>These terms may change as the tool changes. Continued use after a change means you accept the update.</p>

        <p className="pt-4">
          <Link href="/" className="underline text-brand-gold">
            Back to sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

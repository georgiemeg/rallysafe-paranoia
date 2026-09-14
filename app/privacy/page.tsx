import Link from "next/link";

export const metadata = { title: "Privacy Policy — RallySafe Paranoia" };

export default function PrivacyPage() {
  return (
    <div className="min-h-[calc(100dvh-49px)] bg-[#0a0e14] text-neutral-100">
      <div className="border-b border-white/10 bg-brand-maroon px-4 py-3">
        <span className="text-xs font-mono uppercase tracking-widest text-white font-bold">Privacy Policy</span>
      </div>
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4 text-sm text-neutral-300 leading-relaxed">
        <p className="text-neutral-500">Last updated: {new Date().toISOString().slice(0, 10)}</p>

        <h2 className="text-neutral-100 font-semibold text-base pt-2">What we collect</h2>
        <p>
          Your mobile phone number (if you opt in to texts), the cars/drivers you choose to track, and which alert
          types you&apos;ve turned on for each. We also store a device identifier in your browser&apos;s local
          storage so your tracked cars persist between visits.
        </p>

        <h2 className="text-neutral-100 font-semibold text-base pt-2">How we use it</h2>
        <p>
          Solely to send you the alerts you&apos;ve requested (via SMS and/or the in-app inbox) for the cars you&apos;re
          tracking. Your phone number is never sold, shared with advertisers, or used for marketing outside of the
          alerts you signed up for.
        </p>

        <h2 className="text-neutral-100 font-semibold text-base pt-2">Text messaging data</h2>
        <p>
          No mobile information will be shared with third parties or affiliates for marketing/promotional purposes.
          Information sharing to subcontractors in support services, such as customer service, is permitted. All
          other use case categories exclude text messaging originator opt-in data and consent; this information will
          not be shared with any third parties.
        </p>

        <h2 className="text-neutral-100 font-semibold text-base pt-2">Opting out</h2>
        <p>
          Reply STOP to any text to stop receiving SMS alerts immediately, or turn off individual alert types in the
          app. You can also delete your tracked cars and phone number from the app at any time.
        </p>

        <h2 className="text-neutral-100 font-semibold text-base pt-2">Third-party data</h2>
        <p>
          Rally stage times, positions, and event info come from public/third-party rally tracking and results
          feeds — we don&apos;t control the accuracy or availability of that underlying data.
        </p>

        <p className="pt-4">
          <Link href="/text-signup" className="underline text-brand-gold">
            Back to sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

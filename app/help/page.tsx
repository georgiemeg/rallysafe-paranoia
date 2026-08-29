"use client";

/**
 * Full feature reference for the whole app. Built per Helen's eval feedback:
 * "I think it's really important that everything you showed me... there's got to be
 * some sort of map, or just a list of all the features, so people use the whole app
 * as it's meant to be used."
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#11151c] p-4 sm:p-5">
      <h2 className="font-[family-name:var(--font-display)] text-base text-brand-gold tracking-tight mb-3">
        {title}
      </h2>
      <div className="space-y-3 text-sm text-neutral-300">{children}</div>
    </div>
  );
}

function Feature({ icon, name, children }: { icon: string; name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-lg leading-none shrink-0">{icon}</span>
      <div>
        <div className="font-bold text-neutral-100">{name}</div>
        <p className="text-neutral-400 leading-snug">{children}</p>
      </div>
    </div>
  );
}

export default function HelpPage() {
  return (
    <div className="min-h-[calc(100vh-49px)] bg-[#0a0e14]">
      <div className="border-b border-white/10 bg-neutral-300 px-4 py-3">
        <span className="text-xs font-mono uppercase tracking-widest text-brand-ink font-bold">
          ❓ Help &amp; Feature Guide
        </span>
      </div>

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <p className="text-sm text-neutral-400">
          Everything the app does, in one place. Every checkbox and section also has a small{" "}
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-current text-[10px] mx-0.5">i</span>{" "}
          icon next to it. Hover it, or tap it on mobile, for a quick explanation right where you need it.
        </p>

        <Section title="Setup Page">
          <Feature icon="🎯" name="Choose Who To Track">
            Search the live entry list for any car by number, driver, or co-driver name, then click
            &quot;Add →&quot; to move it into your Tracked panel.
          </Feature>
          <Feature icon="🚦" name="Stage Start / Stage Finish">
            Get a text the instant a tracked car starts or finishes a stage, so you always know
            they&apos;re actually on their way.
          </Feature>
          <Feature icon="⏱️" name="Stage Times">
            After each stage, you get that car&apos;s time and position, compared against its own
            prior pass on the same stage and the cars right ahead of it. Text back anytime for a
            fresh re-check.
          </Feature>
          <Feature icon="🏆" name="Overall Time">
            You get the car&apos;s overall rally position plus the 3 cars ahead and 3 behind. Text{" "}
            <span className="text-brand-teal font-mono">CAR # CLASS ONLY</span> to switch that
            comparison to just cars in the same class, or{" "}
            <span className="text-brand-teal font-mono">CAR # ALL CLASSES</span> to switch back.
          </Feature>
          <Feature icon="🚨" name="Incident Detection">
            This one watches the car&apos;s real accelerometer data instead of just its GPS
            position on the map. A car with a weak signal that&apos;s still genuinely moving
            won&apos;t trigger a false alarm. Only a true stop of 3 or more minutes on stage does.
          </Feature>
          <Feature icon="🔧" name="Service Estimates">
            Predicted arrival times at each upcoming service point for this car. Only works on
            ARA-sanctioned events, since other rallies don&apos;t publish this data publicly.
          </Feature>
          <Feature icon="💾" name="Save & Start Tracking">
            Saves every car and alert-type choice for this device in one go. Nothing sends until
            you save.
          </Feature>
        </Section>

        <Section title="RallySafe Live">
          <Feature icon="📡" name="Live Map">
            The official RallySafe live-tracking map, embedded directly. It shows the same
            real-time car positions for the selected event that RallySafe itself shows.
          </Feature>
        </Section>

        <Section title="Results">
          <Feature icon="🏁" name="Overall (Live)">
            A running overall classification computed from real stage times: position, total
            time, gap to leader, and interval to the car ahead, refreshed automatically. Colored
            circular badges mark the top 3 in gold, silver, and bronze. DNF cars show grayed out
            at the bottom.
          </Feature>
          <Feature icon="⚠️" name="Penalty availability">
            On ARA events, penalties show as a red PEN badge with the exact seconds added or
            reduced on appeal. On non-ARA events, that data just isn&apos;t published on the
            public feed this table pulls from. Times and positions still stay accurate, but
            penalty adjustments might be missing. A banner reminds you whenever that applies.
          </Feature>
          <Feature icon="🛠️" name="Service Times (tap a row)">
            On ARA events, tap any row to see that car&apos;s predicted service arrival times
            below the table. On non-ARA events this data doesn&apos;t exist yet, so tapping shows
            a quick explanation instead.
          </Feature>
          <Feature icon="⏱️" name="Stage / Split Times">
            The official RallySafe results site, embedded directly. It shows full per-stage and
            split times exactly as published.
          </Feature>
        </Section>

        <Section title="Text Commands (once set up)">
          <Feature icon="💬" name="HELP">
            Texts back the full list of available commands.
          </Feature>
          <Feature icon="💬" name="OVERALL TIME CHECK">
            Re-sends current overall standings for every car you&apos;re tracking.
          </Feature>
          <Feature icon="💬" name="STAGE TIME CHECK">
            Re-sends the latest stage time for every car you&apos;re tracking.
          </Feature>
          <Feature icon="💬" name="CAR # CLASS ONLY / CAR # ALL CLASSES">
            Switches that car&apos;s comparisons between only cars in its class and every car in
            the event.
          </Feature>
        </Section>

        <p className="text-center text-[11px] text-neutral-600 font-mono pb-6">
          Live positions update continuously. Alerts and standings refresh about every 20 seconds.
        </p>
      </div>
    </div>
  );
}

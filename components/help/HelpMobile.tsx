"use client";

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

function Step({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-brand-gold text-brand-ink font-mono text-xs font-bold shrink-0">
        {n}
      </span>
      <p className="text-neutral-300 leading-snug">{children}</p>
    </div>
  );
}

export function HelpMobile() {
  return (
    <div className="min-h-[calc(100vh-49px)] bg-[#0a0e14]">
      <div className="border-b border-white/10 bg-neutral-300 px-4 py-3">
        <span className="text-xs font-mono uppercase tracking-widest text-brand-ink font-bold">
          ❓ Help & Feature Guide
        </span>
      </div>

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <p className="text-sm text-neutral-400">
          How to use every screen in RallySafe Paranoia. Next to most controls there is a small{" "}
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-current text-[10px] mx-0.5">
            i
          </span>{" "}
          icon. Hover it, or tap it on your phone, for a short explanation right there.
        </p>

        <Section title="The four tabs">
          <Feature icon="🏠" name="Home">
            Pick the rally, enter your phone number, add the cars you care about, and choose
            which alerts each car should send. This is the only place you set things up.
          </Feature>
          <Feature icon="📡" name="RallySafe Live">
            A live map of cars in this tab, plotted from RallySafe positions. You can also open
            the official RallySafe map in a new tab if you want their full app.
          </Feature>
          <Feature icon="🏁" name="Results">
            Live overall standings for the rally, plus official stage/split times. Tap a row on
            ARA events to see predicted service times for that car.
          </Feature>
          <Feature icon="❓" name="Help">
            This page.
          </Feature>
        </Section>

        <Section title="Accounts">
          <p>
            Login (top right) saves your cars across devices. Guest still works without an account.
            Username, password, and contact changes are requests — nothing changes until we handle
            them by hand.
          </p>
        </Section>

        <Section title="Home — first-time setup">
          <Step n="1">
            Choose the event from the list. Ojibwe, Barossa, whatever is running. Alerts only
            fire for the event you save.
          </Step>
          <Step n="2">
            Type the phone number that should get texts. It is saved on this phone/browser so
            you do not retype it next time. US numbers can be 10 digits; anything else needs the
            country code.
          </Step>
          <Step n="3">
            Search the entry list by car number, driver, or co-driver. Tap Add on each car you
            want. They move into the Tracked panel on the right.
          </Step>
          <Step n="4">
            On each tracked car, tick the alerts you want. Unticked means silence for that type.
            Service Estimates is greyed out unless the rally is ARA.
          </Step>
          <Step n="5">
            Tap Save & Start Tracking. Nothing texts you until you save. You should get a
            confirmation text (and the same note in the in-app alert box). Save that number in
            your contacts so later alerts are not treated as junk.
          </Step>
        </Section>

        <Section title="Alert types (one checkbox each)">
          <Feature icon="🚦" name="Stage Start">
            Texts you the moment that car starts a stage.
          </Feature>
          <Feature icon="🏁" name="Stage Finish">
            Texts you the moment that car finishes a stage.
          </Feature>
          <Feature icon="⏱️" name="Stage Times">
            After the stage, sends that stage&apos;s time and position, compared with the same
            stage&apos;s earlier pass and the cars just ahead. You can also text back later for a
            fresh check.
          </Feature>
          <Feature icon="🏆" name="Overall Time">
            Sends overall rally position plus the 3 cars ahead and behind. Text{" "}
            <span className="text-brand-teal font-mono">CAR 25 CLASS ONLY</span> (use the real
            number) to compare only inside that car&apos;s class, or{" "}
            <span className="text-brand-teal font-mono">CAR 25 ALL CLASSES</span> to go back.
          </Feature>
          <Feature icon="🚨" name="Incident Detection">
            Only on a stage while the car is racing. If speed stays under 5 and they have not
            moved more than about 15 metres for over a minute, you get one alert with a tappable
            map pin. They have to actually move again before another can fire. Does not fire in
            service or overnight.
          </Feature>
          <Feature icon="🔧" name="Service Estimates">
            Predicted arrival at each upcoming service. ARA events only. Other rallies do not
            publish this, so the box is disabled there.
          </Feature>
        </Section>

        <Section title="Test text and in-app alerts">
          <Feature icon="📱" name="Send test text">
            On Home, under your phone number, tap Send test text. It fires one message to that
            number so you can confirm texts actually arrive. If the carrier is still blocking
            us, the same test still shows up in the in-app alert box.
          </Feature>
          <Feature icon="📬" name="Show alerts in the app">
            Tick the box at the very bottom of Home. A panel opens with every alert this device
            has received, newest first. Same content as the texts. Use this if you would rather
            not get SMS, or as a backup when a text does not come through. Untick to hide it.
          </Feature>
        </Section>

        <Section title="Results page">
          <Feature icon="🏁" name="Overall (Live)">
            Running classification from real stage times: position, total time, gap to leader,
            interval to the car ahead. Gold / silver / bronze badges on the top 3. DNF cars sit
            greyed out at the bottom. Car numbers are neon unless the car has DNFed. PEN shows
            in neon with the seconds when we have that data.
          </Feature>
          <Feature icon="⚠️" name="Penalties">
            On ARA events, penalties show as a PEN badge with the seconds. On other events the
            public feed often has zeros even when a penalty happened, so a note on the page
            tells you standings are stage times only.
          </Feature>
          <Feature icon="🛠️" name="Tap a row">
            ARA: opens that car&apos;s predicted service arrivals under the table. Not ARA: a
            short note that service estimates are ARA-only.
          </Feature>
          <Feature icon="⏱️" name="Stage / Split Times">
            RallySafe&apos;s official results page, sitting in this tab.
          </Feature>
        </Section>

        <Section title="Text commands (after you have saved)">
          <Feature icon="💬" name="HELP">
            Replies with the list of commands.
          </Feature>
          <Feature icon="💬" name="OVERALL TIME CHECK">
            Re-sends current overall standings for every car you are tracking.
          </Feature>
          <Feature icon="💬" name="STAGE TIME CHECK">
            Re-sends the latest stage time for every car you are tracking.
          </Feature>
          <Feature icon="💬" name="CAR # CLASS ONLY / CAR # ALL CLASSES">
            Switches that car&apos;s comparisons between only its class and the whole field.
            Example: CAR 25 CLASS ONLY.
          </Feature>
        </Section>

        <p className="text-center text-[11px] text-neutral-600 font-mono pb-6">
          Live positions update continuously. Alerts and standings refresh about every 20 seconds.
        </p>
      </div>
    </div>
  );
}

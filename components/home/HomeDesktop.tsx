"use client";

import { useEffect, useState, useCallback } from "react";
import { getDeviceId, getSavedPhone, savePhoneLocally, hasSmsConsent, saveSmsConsentLocally, getLastEventId, saveLastEventId } from "@/lib/device";
import { InfoTooltip } from "@/components/InfoTooltip";
import { Skeleton } from "@/components/Skeleton";
import { HeroBanner } from "@/components/home/HeroBanner";
import { SmsConsentModal } from "@/components/home/SmsConsentModal";

interface InboxMsg {
  id: string;
  alertType: string;
  body: string;
  carNumber: string;
  createdAt: number;
}

interface RSEvent {
  eventId: number;
  name: string;
}

interface RSEntrySlim {
  entryId: number;
  identifier: string;
  carClass: string;
  driver: string;
  navigator: string | null;
  carModelYear: string;
}

const ALERT_LABELS: { key: string; label: string; icon: string; araOnly?: boolean; info: string }[] = [
  {
    key: "stageStart",
    label: "Stage Start",
    icon: "\uD83D\uDEA6",
    info: "Texts you the moment this car starts a stage, so you know they're actually on their way.",
  },
  {
    key: "stageFinish",
    label: "Stage Finish",
    icon: "\uD83C\uDFC1",
    info: "Texts you the moment this car finishes a stage, so you can stop stressing.",
  },
  {
    key: "stageTimes",
    label: "Stage Times",
    icon: "\u23F1\uFE0F",
    info: "After the stage, sends that stage's time and position, compared to the same stage's prior pass and the cars ahead. Text back anytime for an updated re-check.",
  },
  {
    key: "overallTime",
    label: "Overall Time",
    icon: "\uD83C\uDFC6",
    info: "Sends overall rally position plus the 3 cars ahead and behind. Text CAR # CLASS ONLY to compare only within that car's class instead of every car.",
  },
  {
    key: "incidentDetection",
    label: "Incident Detection",
    icon: "\uD83D\uDEA8",
    info: "Only fires on stage while racing. If speed stays under 5 and the car has not moved more than about 15 metres for over a minute, you get one alert with a map pin. They have to actually move again before another can fire.",
  },
  {
    key: "serviceEstimates",
    label: "Service Estimates",
    icon: "\uD83D\uDD27",
    araOnly: true,
    info: "Sends predicted arrival times at each upcoming service point. Only works for ARA-sanctioned events since other rallies don't publish this data.",
  },
];

type AlertsMap = Record<string, boolean>;

interface TrackedCar extends RSEntrySlim {
  alerts: AlertsMap;
}

function MessageBody({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="text-sm text-neutral-200 space-y-0.5">
      {lines.map((line, i) => {
        const highlight = line.includes(">>>");
        const bits = line.split(/(https?:\/\/[^\s]+)/g);
        return (
          <div
            key={i}
            className={highlight ? "text-brand-gold font-bold bg-brand-gold/15 px-1 rounded" : undefined}
          >
            {bits.map((part, j) =>
              /^https?:\/\//.test(part) ? (
                <a
                  key={j}
                  href={part}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-teal underline break-all"
                >
                  Open in Google Maps
                </a>
              ) : (
                <span key={j}>{part || "\u00a0"}</span>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

function defaultAlerts(): AlertsMap {
  const out: AlertsMap = {};
  for (const a of ALERT_LABELS) out[a.key] = false;
  return out;
}

function CarIdentity({
  driver,
  navigator,
  carClass,
  carModelYear,
}: {
  driver: string;
  navigator: string | null;
  carClass: string;
  carModelYear: string;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="font-medium text-sm text-neutral-300 break-words">
        {driver}
        {navigator ? ` / ${navigator}` : ""}
      </div>
      <div className="text-xs text-neutral-500 break-words mt-0.5">
        {carClass ? (
          <span className="text-brand-teal font-mono uppercase mr-1.5">{carClass}</span>
        ) : null}
        {carModelYear}
      </div>
    </div>
  );
}

export function HomeDesktop() {
  const [deviceId, setDeviceId] = useState("");
  const [phone, setPhone] = useState("");
  const [events, setEvents] = useState<RSEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<RSEvent | null>(null);
  const [araEventIds, setAraEventIds] = useState<Set<number>>(new Set());
  const [entries, setEntries] = useState<RSEntrySlim[]>([]);
  const [tracked, setTracked] = useState<Map<number, TrackedCar>>(new Map());
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [showConfirmPopup, setShowConfirmPopup] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [pendingConsentAction, setPendingConsentAction] = useState<null | "save" | "test">(null);
  const [search, setSearch] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [showInbox, setShowInbox] = useState(false);
  const [inbox, setInbox] = useState<InboxMsg[]>([]);
  const [inboxFullscreen, setInboxFullscreen] = useState(false);
  const [commandText, setCommandText] = useState("");
  const [commandBusy, setCommandBusy] = useState(false);

  useEffect(() => {
    setDeviceId(getDeviceId());
    setPhone(getSavedPhone());
  }, []);

  useEffect(() => {
    fetch("/api/events/active?live=1")
      .then((r) => r.json())
      .then((d) => {
        const list = d.events ?? [];
        setEvents(list);
        setAraEventIds(new Set<number>(d.araEventIds ?? []));
        // Default to the event this device last started tracking, else the server's
        // "active" event, else the first in the list.
        const lastId = getLastEventId();
        const preferredId =
          lastId && list.some((ev: RSEvent) => ev.eventId === lastId)
            ? lastId
            : d.activeEventId ?? list[0]?.eventId ?? null;
        const match = list.find((ev: RSEvent) => ev.eventId === preferredId);
        if (match) setSelectedEvent(match);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoadingEvents(false));
  }, []);

  useEffect(() => {
    if (!selectedEvent || !deviceId) return;
    setLoadingEntries(true);
    setTracked(new Map());

    const safeJson = async (res: Response) => {
      if (!res.ok) return null;
      try {
        return await res.json();
      } catch {
        return null;
      }
    };

    Promise.all([
      fetch(`/api/events/${selectedEvent.eventId}/entries`, { credentials: "include" }).then(safeJson),
      fetch(`/api/subscriptions?deviceId=${deviceId}&eventId=${selectedEvent.eventId}`).then(safeJson),
      fetch("/api/auth/me", { credentials: "include" }).then(safeJson),
    ])
      .then(([entriesData, subsData, me]) => {
        const entryList: RSEntrySlim[] = entriesData?.entries ?? [];
        setEntries(entryList);

        const existingMap = new Map<number, TrackedCar>();
        for (const sub of subsData?.subscriptions ?? []) {
          const matching = entryList.find((e) => e.entryId === sub.entryId);
          if (matching) {
            existingMap.set(sub.entryId, { ...matching, alerts: { ...defaultAlerts(), ...sub.alerts } });
          }
        }

        const cloud = me?.cloud as
          | { eventId?: number; phone?: string | null; cars?: (RSEntrySlim & { alerts?: AlertsMap })[] }
          | null
          | undefined;
        if (cloud?.phone) {
          setPhone(cloud.phone);
          savePhoneLocally(cloud.phone);
        }
        if (
          existingMap.size === 0 &&
          cloud?.cars?.length &&
          (!cloud.eventId || cloud.eventId === selectedEvent.eventId)
        ) {
          for (const car of cloud.cars) {
            const matching = entryList.find((e) => e.entryId === car.entryId || e.identifier === car.identifier);
            if (matching) {
              existingMap.set(matching.entryId, { ...matching, alerts: { ...defaultAlerts(), ...car.alerts } });
            }
          }
          const phoneForSave = cloud.phone || getSavedPhone();
          if (existingMap.size && phoneForSave) {
            fetch("/api/subscriptions", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                deviceId,
                phone: phoneForSave,
                eventId: selectedEvent.eventId,
                cars: Array.from(existingMap.values()).map((c) => ({
                  entryId: c.entryId,
                  carNumber: c.identifier,
                  driverName: c.driver,
                  codriverName: c.navigator ?? "",
                  carClass: c.carClass,
                  carModelYear: c.carModelYear,
                  alerts: c.alerts,
                })),
              }),
            }).catch(() => {});
          }
        }

        setTracked(existingMap);

        if (subsData?.device?.phone) setPhone(subsData.device.phone);
      })
      .finally(() => setLoadingEntries(false));
  }, [selectedEvent, deviceId]);

  const loadInbox = useCallback(async () => {
    if (!deviceId) return;
    try {
      const res = await fetch(`/api/inbox?deviceId=${encodeURIComponent(deviceId)}`);
      const data = await res.json();
      setInbox(data.messages ?? []);
    } catch {
      /* keep last list */
    }
  }, [deviceId]);

  useEffect(() => {
    if (!showInbox) return;
    loadInbox();
    const t = setInterval(loadInbox, 5000);
    return () => clearInterval(t);
  }, [showInbox, loadInbox]);

  const addCar = useCallback((entry: RSEntrySlim) => {
    setTracked((prev) => {
      const next = new Map(prev);
      next.set(entry.entryId, { ...entry, alerts: defaultAlerts() });
      return next;
    });
  }, []);

  const removeCar = useCallback((entryId: number) => {
    setTracked((prev) => {
      const next = new Map(prev);
      next.delete(entryId);
      return next;
    });
  }, []);

  const toggleAlert = useCallback((entryId: number, alertKey: string) => {
    setTracked((prev) => {
      const next = new Map(prev);
      const car = next.get(entryId);
      if (!car) return prev;
      next.set(entryId, { ...car, alerts: { ...car.alerts, [alertKey]: !car.alerts[alertKey] } });
      return next;
    });
  }, []);

  const selectAllAlerts = useCallback((entryId: number, isAraEvent: boolean) => {
    setTracked((prev) => {
      const next = new Map(prev);
      const car = next.get(entryId);
      if (!car) return prev;
      const selectable = ALERT_LABELS.filter((a) => !(a.araOnly && !isAraEvent));
      const allOn = selectable.every((a) => car.alerts[a.key]);
      const alerts = { ...car.alerts };
      for (const a of selectable) alerts[a.key] = !allOn;
      next.set(entryId, { ...car, alerts });
      return next;
    });
  }, []);

  const performSave = async (withConsent: boolean) => {
    if (!selectedEvent) return;
    setSaving(true);
    setSaveMessage("");
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          phone,
          smsConsent: withConsent,
          eventId: selectedEvent.eventId,
          cars: Array.from(tracked.values()).map((c) => ({
            entryId: c.entryId,
            carNumber: c.identifier,
            driverName: c.driver,
            codriverName: c.navigator ?? "",
            carClass: c.carClass,
            carModelYear: c.carModelYear,
            alerts: c.alerts,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.needsConsent) {
          setPendingConsentAction("save");
          setShowConsent(true);
          setSaveMessage("");
        } else {
          setSaveMessage(data.error ?? "Failed to save.");
        }
      } else {
        saveSmsConsentLocally();
        savePhoneLocally(data.phone);
        saveLastEventId(selectedEvent.eventId);
        setPhone(data.phone);
        setSaveMessage(`Saved! Tracking ${tracked.size} car(s).`);
        fetch("/api/auth/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "cloud",
            cloud: {
              eventId: selectedEvent.eventId,
              eventName: selectedEvent.name,
              phone: data.phone,
              cars: Array.from(tracked.values()).map((c) => ({
                entryId: c.entryId,
                identifier: c.identifier,
                driver: c.driver,
                navigator: c.navigator,
                carClass: c.carClass,
                carModelYear: c.carModelYear,
                alerts: c.alerts,
              })),
            },
          }),
        }).catch(() => {});
        if (data.confirmationSmsSent) {
          setShowConfirmPopup(true);
        }
        await loadInbox();
      }
    } catch {
      setSaveMessage("Network error saving subscriptions.");
    } finally {
      setSaving(false);
    }
  };

  const performTestText = async (withConsent: boolean) => {
    if (!phone.trim()) {
      setTestMessage("Enter a phone number first.");
      return;
    }
    setTesting(true);
    setTestMessage("");
    try {
      const res = await fetch("/api/alerts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          phone,
          smsConsent: withConsent,
          eventId: selectedEvent?.eventId ?? 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.needsConsent) {
          setPendingConsentAction("test");
          setShowConsent(true);
          setTestMessage("");
        } else {
          setTestMessage(data.error ?? "Test failed.");
        }
      } else if (data.sms) {
        saveSmsConsentLocally();
        savePhoneLocally(data.phone);
        setPhone(data.phone);
        setTestMessage("Test text sent. Check your phone, and the in-app box if you have it open.");
      } else {
        setTestMessage(
          "Could not send the text (the carrier may still be blocking us). The test is in the in-app alert box instead."
        );
        setShowInbox(true);
      }
      await loadInbox();
    } catch {
      setTestMessage("Network error sending the test.");
    } finally {
      setTesting(false);
    }
  };

  const requireConsent = (action: "save" | "test") => {
    if (hasSmsConsent()) {
      if (action === "save") void performSave(false);
      else void performTestText(false);
      return;
    }
    setPendingConsentAction(action);
    setShowConsent(true);
  };

  const handleSave = async () => {
    if (!selectedEvent) return;
    if (!phone.trim()) {
      setSaveMessage("Enter a phone number first.");
      return;
    }
    requireConsent("save");
  };

  const handleTestText = async () => {
    requireConsent("test");
  };

  const handleCommand = async () => {
    const cmd = commandText.trim();
    if (!cmd || !deviceId) return;
    setCommandBusy(true);
    try {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, command: cmd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInbox((prev) => [
          {
            id: `err-${Date.now()}`,
            alertType: "command",
            body: data.error ?? "Command failed.",
            carNumber: "",
            createdAt: Date.now(),
          },
          ...prev,
        ]);
      } else {
        setCommandText("");
        await loadInbox();
      }
    } catch {
      setInbox((prev) => [
        {
          id: `err-${Date.now()}`,
          alertType: "command",
          body: "Network error running that command.",
          carNumber: "",
          createdAt: Date.now(),
        },
        ...prev,
      ]);
    } finally {
      setCommandBusy(false);
    }
  };

  const availableEntries = entries.filter((e) => !tracked.has(e.entryId));
  const filteredAvailable = availableEntries.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.identifier.toLowerCase().includes(q) ||
      e.driver.toLowerCase().includes(q) ||
      (e.navigator ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div
      className="min-h-[calc(100vh-49px)] bg-[#0a0e14] text-neutral-100"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 7px)",
      }}
    >
      <HeroBanner />

      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-5 sm:py-10 max-lg:py-5">
        {/* Event picker — teal block */}
        <section className="mb-6 rounded-2xl bg-brand-teal p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-ink text-brand-gold font-mono text-sm font-bold shrink-0">
              01
            </span>
            <h2 className="text-base sm:text-lg font-[family-name:var(--font-display)] tracking-tight text-white">
              Select Event
            </h2>
          </div>
          {loadingEvents ? (
            <Skeleton className="h-11 w-full" />
          ) : events.length === 0 ? (
            <p className="text-white/70 text-sm">No live/upcoming events found right now.</p>
          ) : (
            <select
              className="w-full bg-brand-ink border border-white/10 rounded-lg px-4 py-3 text-neutral-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
              value={selectedEvent?.eventId ?? ""}
              onChange={(e) => {
                const ev = events.find((ev) => ev.eventId === Number(e.target.value));
                setSelectedEvent(ev ?? null);
                if (ev) saveLastEventId(ev.eventId);
              }}
            >
              <option value="">Select an event...</option>
              {events.map((ev) => (
                <option key={ev.eventId} value={ev.eventId}>
                  {ev.name}
                </option>
              ))}
            </select>
          )}
        </section>

        {selectedEvent && (
          <>
            {/* Phone number — Slate Blue */}
            <section className="mb-6 rounded-2xl bg-brand-golden-orange p-5 sm:p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-ink text-brand-gold font-mono text-sm font-bold shrink-0">
                  02
                </span>
                <h2 className="text-base sm:text-lg font-[family-name:var(--font-display)] tracking-tight text-white">
                  Alert Number
                </h2>
                <InfoTooltip text="The phone number that receives every text alert for the cars you track below. Saved to this device only." />
              </div>
              <input
                type="tel"
                placeholder="+1 314 555 1234"
                className="w-full max-w-sm bg-brand-ink border border-white/10 rounded-lg px-4 py-3 text-neutral-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <p className="text-xs text-white/80 mt-1.5">
                Saved to this device, so you won&apos;t need to re-enter it next time.
              </p>
              <button
                type="button"
                onClick={handleTestText}
                disabled={testing}
                className="mt-3 bg-brand-ink text-white text-sm font-medium rounded-full px-4 py-2 disabled:opacity-50"
              >
                {testing ? "Sending…" : "Send test text"}
              </button>
              {testMessage && <p className="text-xs text-white mt-2">{testMessage}</p>}
            </section>

            {/* Entries + Tracked — maroon block */}
            <section className="mb-6 rounded-2xl bg-[#2F6B3D] p-5 sm:p-6">
              <div className="flex items-center gap-3 mb-4">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-ink text-brand-gold font-mono text-sm font-bold shrink-0">
                  03
                </span>
                <h2 className="text-base sm:text-lg font-[family-name:var(--font-display)] tracking-tight text-white">
                  Choose Who To Track
                </h2>
                <InfoTooltip text="Search and add cars from the entry list on the left. Each added car moves to the Tracked panel on the right, where you choose exactly which alerts it should send." />
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                {/* Left: available entries */}
                <div className="rounded-xl border border-white/10 bg-brand-ink overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/10 bg-white/[0.04]">
                    <input
                      type="text"
                      placeholder="Search car #, driver, co-driver…"
                      className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-brand-gold"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {loadingEntries ? (
                    <div className="p-4 space-y-3">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-3">
                          <Skeleton className="w-9 h-9 rounded-full shrink-0" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-3 w-2/3" />
                            <Skeleton className="h-3 w-1/3" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="divide-y divide-white/5 max-h-[55vh] overflow-y-auto">
                      {filteredAvailable.map((entry) => (
                        <div
                          key={entry.entryId}
                          className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors"
                        >
                          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-brand-gold text-brand-ink font-mono text-xs font-bold shrink-0">
                            {entry.identifier}
                          </span>
                          <CarIdentity
                            driver={entry.driver}
                            navigator={entry.navigator}
                            carClass={entry.carClass}
                            carModelYear={entry.carModelYear}
                          />
                          <button
                            onClick={() => addCar(entry)}
                            className="shrink-0 bg-brand-teal hover:bg-brand-gold hover:text-brand-ink text-white text-xs font-mono uppercase tracking-wide px-3 py-1.5 rounded-full transition-colors mt-0.5"
                          >
                            Add →
                          </button>
                        </div>
                      ))}
                      {filteredAvailable.length === 0 && (
                        <div className="px-4 py-8 text-center text-neutral-500 text-sm">
                          {entries.length === 0 ? (
                            <>
                              <p className="mb-1">No entries available from RallySafe right now.</p>
                              <p className="text-xs text-neutral-600">
                                This usually means the event is between legs or days, like
                                overnight. Entries typically reappear once the next stage day
                                starts.
                              </p>
                              <button
                                onClick={() => selectedEvent && setSelectedEvent({ ...selectedEvent })}
                                className="mt-3 text-brand-orange hover:text-brand-orange/80 text-xs underline"
                              >
                                Retry
                              </button>
                            </>
                          ) : (
                            "All matching entries are already tracked."
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right: tracked cars with per-alert checkboxes */}
                <div className="rounded-xl border border-brand-gold/30 bg-brand-ink overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/10 bg-brand-gold/10 flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-widest text-brand-gold">
                      Tracked
                    </span>
                    <span className="text-xs font-mono text-neutral-400">{tracked.size} car(s)</span>
                  </div>
                  <div className="divide-y divide-white/5 max-h-[55vh] overflow-y-auto">
                    {Array.from(tracked.values()).map((car) => (
                      <div key={car.entryId} className="px-4 py-3 relative tooltip-boundary">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-gold text-brand-ink font-mono text-xs font-bold shrink-0 mt-0.5">
                              {car.identifier}
                            </span>
                            <CarIdentity
                              driver={car.driver}
                              navigator={car.navigator}
                              carClass={car.carClass}
                              carModelYear={car.carModelYear}
                            />
                          </div>
                          <div className="flex items-start gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                selectAllAlerts(
                                  car.entryId,
                                  selectedEvent ? araEventIds.has(selectedEvent.eventId) : false
                                )
                              }
                              className="shrink-0 text-emerald-400 hover:text-emerald-300 text-xs px-1"
                            >
                              ✓ Select all
                            </button>
                            <button
                              onClick={() => removeCar(car.entryId)}
                              className="shrink-0 text-brand-orange hover:text-brand-orange/70 text-xs px-1"
                            >
                              ✕ Remove
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-2.5 md:pl-[42px]">
                          {ALERT_LABELS.map((a) => {
                            const isAraEvent = selectedEvent ? araEventIds.has(selectedEvent.eventId) : false;
                            const disabled = a.araOnly && !isAraEvent;
                            return (
                              <label
                                key={a.key}
                                title={disabled ? "Service estimates are only available for ARA events" : undefined}
                                className={`flex items-center gap-2 min-w-0 text-base ${
                                  disabled
                                    ? "cursor-not-allowed text-neutral-700"
                                    : "cursor-pointer text-neutral-300 hover:text-neutral-100"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={disabled}
                                  className={`w-6 h-6 shrink-0 ${
                                    disabled
                                      ? "accent-neutral-700"
                                      : a.key === "incidentDetection"
                                        ? "accent-brand-orange"
                                        : "accent-brand-teal"
                                  }`}
                                  checked={car.alerts[a.key] ?? false}
                                  onChange={() => toggleAlert(car.entryId, a.key)}
                                />
                                <span className="shrink-0">{a.icon}</span>
                                <span className="leading-tight min-w-0">{a.label}</span>
                                <InfoTooltip text={a.info} className="shrink-0 ml-auto" />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {tracked.size === 0 && (
                      <p className="px-4 py-8 text-center text-neutral-500 text-sm">
                        Click &quot;Add →&quot; on the left to start tracking cars.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <div className="sticky bottom-0 z-30 pt-4 pb-3 -mx-3 sm:-mx-6 px-3 sm:px-6 bg-gradient-to-t from-[#0a0e14] via-[#0a0e14]/95 to-transparent">
              {tracked.size > 0 && (
                <p className="mb-2 text-center text-[11px] font-mono uppercase tracking-widest text-neutral-400">
                  <span className="text-brand-gold">{tracked.size}</span> car(s) armed
                </p>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="save-btn w-full bg-brand-gold hover:bg-brand-gold/90 disabled:opacity-50 text-brand-ink font-bold rounded-full py-4 uppercase tracking-wider text-sm shadow-[0_0_30px_rgba(213,160,33,0.25)]"
              >
                <span className="save-btn__label">{saving ? "Saving…" : "Save & Start Tracking"}</span>
              </button>
              {saveMessage && (
                <p className="text-center text-sm mt-2 text-neutral-100">{saveMessage}</p>
              )}
            </div>

            <p className="text-center text-xs text-neutral-500 mt-4">
              Once saved, text HELP to the alert number for ad-hoc commands (overall time check,
              stage time check, class-only comparisons).
            </p>
            <p className="text-center text-[11px] text-neutral-600 mt-1.5 font-mono">
              Live positions update continuously. Alerts and standings refresh about every 20 seconds.
            </p>

            <label className="mt-6 flex items-start gap-3 text-sm text-neutral-300 cursor-pointer max-w-xl mx-auto">
              <input
                type="checkbox"
                className="w-6 h-6 mt-0.5 accent-brand-teal shrink-0"
                checked={showInbox}
                onChange={(e) => {
                  setShowInbox(e.target.checked);
                  if (!e.target.checked) setInboxFullscreen(false);
                }}
              />
              <span>
                Show alerts in the app. Tick this to open a box with every alert, so you can
                read them here instead of (or as well as) texts.
              </span>
            </label>
            {showInbox && (
              <div
                className={
                  inboxFullscreen
                    ? "fixed inset-0 z-[60] bg-[#0a0e14] flex flex-col"
                    : "mt-3 max-w-xl mx-auto rounded-2xl border border-white/10 bg-[#11151c] overflow-hidden flex flex-col"
                }
              >
                <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
                  <span className="text-xs font-mono uppercase tracking-widest text-brand-gold">
                    In-app alerts
                  </span>
                  <button
                    type="button"
                    onClick={() => setInboxFullscreen((v) => !v)}
                    className="text-xs font-mono uppercase tracking-widest text-neutral-300 hover:text-white border border-white/15 rounded-full px-3 py-1.5"
                  >
                    {inboxFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  </button>
                </div>
                <div
                  className={`overflow-y-auto divide-y divide-white/5 ${
                    inboxFullscreen ? "flex-1" : "max-h-80"
                  }`}
                >
                  {inbox.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-neutral-500 text-center">
                      No alerts yet. Send a test text, run a command below, or wait for a
                      tracked car to fire one.
                    </p>
                  ) : (
                    inbox.map((m) => (
                      <div key={m.id} className="px-4 py-3">
                        <div className="text-[11px] font-mono uppercase tracking-widest text-neutral-500 mb-1">
                          {m.alertType}
                          {m.carNumber ? ` · #${m.carNumber}` : ""}
                          {" · "}
                          {new Date(m.createdAt).toLocaleTimeString()}
                        </div>
                        <MessageBody text={m.body} />
                      </div>
                    ))
                  )}
                </div>
                <form
                  className="border-t border-white/10 p-3 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleCommand();
                  }}
                >
                  <input
                    type="text"
                    value={commandText}
                    onChange={(e) => setCommandText(e.target.value)}
                    placeholder="HELP, OVERALL TIME CHECK, CAR 25 CLASS ONLY…"
                    className="flex-1 min-w-0 bg-brand-ink border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-brand-gold"
                  />
                  <button
                    type="submit"
                    disabled={commandBusy || !commandText.trim()}
                    className="shrink-0 bg-brand-gold text-brand-ink font-bold rounded-lg px-4 py-2 text-sm disabled:opacity-50"
                  >
                    {commandBusy ? "…" : "Send"}
                  </button>
                </form>
              </div>
            )}
          </>
        )}
      </div>

      {showConsent && (
        <SmsConsentModal
          phone={phone}
          busy={saving || testing}
          onConfirm={() => {
            setShowConsent(false);
            const action = pendingConsentAction;
            setPendingConsentAction(null);
            if (action === "test") void performTestText(true);
            else void performSave(true);
          }}
          onCancel={() => {
            setShowConsent(false);
            setPendingConsentAction(null);
          }}
        />
      )}

      {showConfirmPopup && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
          onClick={() => setShowConfirmPopup(false)}
        >
          <div
            className="bg-brand-gold text-brand-ink border border-white/10 rounded-2xl p-6 max-w-sm w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-3xl mb-2">📩</div>
            <h3 className="text-lg font-[family-name:var(--font-display)] mb-2">Confirmation text sent!</h3>
            <p className="text-sm text-brand-ink/70 mb-4">
              Check your phone and save this number to your contacts so alerts don&apos;t get
              missed or filtered as spam.
            </p>
            <button
              onClick={() => setShowConfirmPopup(false)}
              className="bg-brand-ink text-white font-medium rounded-full px-4 py-2.5 w-full"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

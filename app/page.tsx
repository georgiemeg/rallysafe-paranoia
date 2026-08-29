"use client";

import { useEffect, useState, useCallback } from "react";
import { getDeviceId, getSavedPhone, savePhoneLocally } from "@/lib/device";

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

const ALERT_LABELS: { key: string; label: string; icon: string }[] = [
  { key: "stageStart", label: "Stage Start", icon: "🚦" },
  { key: "stageFinish", label: "Stage Finish", icon: "🏁" },
  { key: "stageTimes", label: "Stage Times", icon: "⏱️" },
  { key: "overallTime", label: "Overall Time", icon: "🏆" },
  { key: "incidentDetection", label: "Incident Detection", icon: "🚨" },
];

type AlertsMap = Record<string, boolean>;

interface TrackedCar extends RSEntrySlim {
  alerts: AlertsMap;
}

function defaultAlerts(): AlertsMap {
  const out: AlertsMap = {};
  for (const a of ALERT_LABELS) out[a.key] = false;
  return out;
}

export default function Home() {
  const [deviceId, setDeviceId] = useState("");
  const [phone, setPhone] = useState("");
  const [events, setEvents] = useState<RSEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<RSEvent | null>(null);
  const [entries, setEntries] = useState<RSEntrySlim[]>([]);
  const [tracked, setTracked] = useState<Map<number, TrackedCar>>(new Map());
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [showConfirmPopup, setShowConfirmPopup] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setDeviceId(getDeviceId());
    setPhone(getSavedPhone());
  }, []);

  useEffect(() => {
    fetch("/api/events/active")
      .then((r) => r.json())
      .then((d) => {
        const list = d.events ?? [];
        setEvents(list);
        const activeId = d.activeEventId ?? list[0]?.eventId ?? null;
        const match = list.find((ev: RSEvent) => ev.eventId === activeId);
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
      fetch(`/api/events/${selectedEvent.eventId}/entries`).then(safeJson),
      fetch(`/api/subscriptions?deviceId=${deviceId}&eventId=${selectedEvent.eventId}`).then(safeJson),
    ])
      .then(([entriesData, subsData]) => {
        const entryList: RSEntrySlim[] = entriesData?.entries ?? [];
        setEntries(entryList);

        const existingMap = new Map<number, TrackedCar>();
        for (const sub of subsData?.subscriptions ?? []) {
          const matching = entryList.find((e) => e.entryId === sub.entryId);
          if (matching) {
            existingMap.set(sub.entryId, { ...matching, alerts: { ...defaultAlerts(), ...sub.alerts } });
          }
        }
        setTracked(existingMap);

        if (subsData?.device?.phone) setPhone(subsData.device.phone);
      })
      .finally(() => setLoadingEntries(false));
  }, [selectedEvent, deviceId]);

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

  const handleSave = async () => {
    if (!selectedEvent) return;
    if (!phone.trim()) {
      setSaveMessage("Enter a phone number first.");
      return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          phone,
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
        setSaveMessage(data.error ?? "Failed to save.");
      } else {
        savePhoneLocally(data.phone);
        setPhone(data.phone);
        setSaveMessage(`Saved! Tracking ${tracked.size} car(s).`);
        if (data.confirmationSmsSent) {
          setShowConfirmPopup(true);
        }
      }
    } catch {
      setSaveMessage("Network error saving subscriptions.");
    } finally {
      setSaving(false);
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
    <div className="min-h-[calc(100vh-49px)] bg-[#05070c] text-neutral-100">
      {/* HUD header */}
      <div className="relative overflow-hidden border-b border-white/10 bg-[radial-gradient(ellipse_at_top,_rgba(213,160,33,0.10),_transparent_60%)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex items-center gap-2 text-[10px] sm:text-xs font-mono uppercase tracking-[0.2em] text-brand-gold/70 mb-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-gold animate-pulse" />
            System Online
          </div>
          <h1 className="text-3xl sm:text-5xl tracking-tight font-[family-name:var(--font-display)] leading-none">
            RALLYSAFE <span className="text-brand-gold">PARANOIA</span>
          </h1>
          <p className="text-neutral-500 mt-2 text-sm max-w-xl">
            Track your friends live on stage. Get texted the moment they start, finish, post a
            time, or go quiet.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Event picker */}
        <section className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-brand-gold font-mono text-xs">01</span>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
              Select Event
            </h2>
          </div>
          {loadingEvents ? (
            <p className="text-neutral-500 text-sm">Loading events…</p>
          ) : events.length === 0 ? (
            <p className="text-neutral-500 text-sm">No live/upcoming events found right now.</p>
          ) : (
            <select
              className="w-full bg-[#0a0d14] border border-white/10 rounded-lg px-4 py-3 text-neutral-100 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-brand-teal/50"
              value={selectedEvent?.eventId ?? ""}
              onChange={(e) => {
                const ev = events.find((ev) => ev.eventId === Number(e.target.value));
                setSelectedEvent(ev ?? null);
              }}
            >
              <option value="">— Select an event —</option>
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
            {/* Phone number */}
            <section className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-brand-gold font-mono text-xs">02</span>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
                  Alert Number
                </h2>
              </div>
              <input
                type="tel"
                placeholder="+1 314 555 1234"
                className="w-full max-w-sm bg-[#0a0d14] border border-white/10 rounded-lg px-4 py-3 text-neutral-100 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-brand-teal/50"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <p className="text-xs text-neutral-600 mt-1.5">
                Saved to this device — no need to re-enter it next time.
              </p>
            </section>

            {/* Entries + Tracked */}
            <section className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-brand-gold font-mono text-xs">03</span>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
                  Choose Who To Track
                </h2>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {/* Left: available entries */}
                <div className="rounded-lg border border-white/10 bg-[#0a0d14] overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/10 bg-white/[0.02]">
                    <input
                      type="text"
                      placeholder="Search car #, driver, co-driver…"
                      className="w-full bg-[#05070c] border border-white/10 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-brand-teal/50"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {loadingEntries ? (
                    <p className="text-neutral-500 text-sm p-4">Loading entries…</p>
                  ) : (
                    <div className="divide-y divide-white/5 max-h-[55vh] overflow-y-auto">
                      {filteredAvailable.map((entry) => (
                        <div
                          key={entry.entryId}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              <span className="font-mono text-brand-gold">#{entry.identifier}</span>
                              {entry.carClass ? (
                                <span className="text-neutral-500"> ({entry.carClass})</span>
                              ) : (
                                ""
                              )}
                              {" — "}
                              {entry.driver}
                              {entry.navigator ? ` / ${entry.navigator}` : ""}
                            </div>
                            <div className="text-xs text-neutral-600 truncate">{entry.carModelYear}</div>
                          </div>
                          <button
                            onClick={() => addCar(entry)}
                            className="shrink-0 bg-white/5 hover:bg-brand-teal hover:text-white text-neutral-300 text-xs font-mono uppercase tracking-wide px-3 py-1.5 rounded-md transition-colors"
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
                                This usually means the event is between legs/days (e.g.
                                overnight) — entries typically reappear once the next stage day
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
                <div className="rounded-lg border border-brand-gold/20 bg-[#0a0d14] overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/10 bg-brand-gold/[0.05] flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-widest text-brand-gold/80">
                      Tracked
                    </span>
                    <span className="text-xs font-mono text-neutral-500">{tracked.size} car(s)</span>
                  </div>
                  <div className="divide-y divide-white/5 max-h-[55vh] overflow-y-auto">
                    {Array.from(tracked.values()).map((car) => (
                      <div key={car.entryId} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">
                              <span className="font-mono text-brand-gold">#{car.identifier}</span>
                              {car.carClass ? (
                                <span className="text-neutral-500"> ({car.carClass})</span>
                              ) : (
                                ""
                              )}
                              {" — "}
                              {car.driver}
                              {car.navigator ? ` / ${car.navigator}` : ""}
                            </div>
                            <div className="text-xs text-neutral-600 truncate">{car.carModelYear}</div>
                          </div>
                          <button
                            onClick={() => removeCar(car.entryId)}
                            className="shrink-0 text-brand-maroon/90 hover:text-brand-maroon text-xs px-1"
                          >
                            ✕ Remove
                          </button>
                        </div>
                        <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                          {ALERT_LABELS.map((a) => (
                            <label
                              key={a.key}
                              className="flex items-center gap-2 text-xs cursor-pointer text-neutral-400 hover:text-neutral-200"
                            >
                              <input
                                type="checkbox"
                                className={`w-3.5 h-3.5 ${a.key === "incidentDetection" ? "accent-brand-orange" : "accent-brand-teal"}`}
                                checked={car.alerts[a.key] ?? false}
                                onChange={() => toggleAlert(car.entryId, a.key)}
                              />
                              <span>{a.icon}</span>
                              {a.label}
                            </label>
                          ))}
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

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-brand-teal hover:bg-brand-teal disabled:opacity-50 text-white font-semibold rounded-lg py-3.5 uppercase tracking-wider text-sm transition-colors shadow-[0_0_20px_rgba(0,121,140,0.25)]"
            >
              {saving ? "Saving…" : "Save & Start Tracking"}
            </button>
            {saveMessage && (
              <p className="text-center text-sm mt-2 text-neutral-300">{saveMessage}</p>
            )}

            <p className="text-center text-xs text-neutral-600 mt-4">
              Once saved, text HELP to the alert number for ad-hoc commands (overall time check,
              stage time check, class-only comparisons).
            </p>
          </>
        )}
      </div>

      {showConfirmPopup && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
          onClick={() => setShowConfirmPopup(false)}
        >
          <div
            className="bg-[#0a0d14] border border-white/10 rounded-xl p-6 max-w-sm w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-3xl mb-2">📩</div>
            <h3 className="text-lg font-semibold mb-2">Confirmation text sent!</h3>
            <p className="text-sm text-neutral-400 mb-4">
              Check your phone and save this number to your contacts so alerts don&apos;t get
              missed or filtered as spam.
            </p>
            <button
              onClick={() => setShowConfirmPopup(false)}
              className="bg-brand-teal hover:bg-brand-teal text-white font-medium rounded-lg px-4 py-2 w-full"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

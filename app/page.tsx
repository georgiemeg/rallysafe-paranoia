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

const ALERT_LABELS: { key: string; label: string }[] = [
  { key: "stageStart", label: "Stage Start" },
  { key: "stageFinish", label: "Stage Finish" },
  { key: "stageTimes", label: "Stage Times" },
  { key: "overallTime", label: "Overall Time" },
  { key: "incidentDetection", label: "Incident Detection" },
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
    fetch("/api/events")
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoadingEvents(false));
  }, []);

  useEffect(() => {
    if (!selectedEvent || !deviceId) return;
    setLoadingEntries(true);
    setTracked(new Map());

    Promise.all([
      fetch(`/api/events/${selectedEvent.eventId}/entries`).then((r) => r.json()),
      fetch(`/api/subscriptions?deviceId=${deviceId}&eventId=${selectedEvent.eventId}`).then((r) => r.json()),
    ])
      .then(([entriesData, subsData]) => {
        const entryList: RSEntrySlim[] = entriesData.entries ?? [];
        setEntries(entryList);

        const existingMap = new Map<number, TrackedCar>();
        for (const sub of subsData.subscriptions ?? []) {
          const matching = entryList.find((e) => e.entryId === sub.entryId);
          if (matching) {
            existingMap.set(sub.entryId, { ...matching, alerts: { ...defaultAlerts(), ...sub.alerts } });
          }
        }
        setTracked(existingMap);

        if (subsData.device?.phone) setPhone(subsData.device.phone);
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
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6 max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">🏁 RallySafe Paranoia</h1>
        <p className="text-neutral-400 mt-1">
          Track your friends live on stage — texts for stage starts, finishes, times, and stalls.
        </p>
      </header>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">1. Pick an event</h2>
        {loadingEvents ? (
          <p className="text-neutral-500">Loading events…</p>
        ) : events.length === 0 ? (
          <p className="text-neutral-500">No live/upcoming events found right now.</p>
        ) : (
          <select
            className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 text-neutral-100"
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
          <section className="mb-6">
            <h2 className="text-lg font-semibold mb-2">2. Your phone number</h2>
            <input
              type="tel"
              placeholder="+1 314 555 1234"
              className="w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 text-neutral-100"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="text-xs text-neutral-500 mt-1">
              Saved to this device — you won&apos;t need to re-enter it here next time.
            </p>
          </section>

          <section className="mb-6 grid md:grid-cols-2 gap-4">
            {/* Left: available entries */}
            <div>
              <h2 className="text-lg font-semibold mb-2">3. All entries</h2>
              <input
                type="text"
                placeholder="Search car #, driver, co-driver…"
                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2 mb-3 text-neutral-100"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {loadingEntries ? (
                <p className="text-neutral-500">Loading entries…</p>
              ) : (
                <div className="border border-neutral-800 rounded-lg divide-y divide-neutral-800 max-h-[60vh] overflow-y-auto">
                  {filteredAvailable.map((entry) => (
                    <div
                      key={entry.entryId}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-900"
                    >
                      <div className="flex-1">
                        <div className="font-medium">
                          #{entry.identifier}
                          {entry.carClass ? ` (${entry.carClass})` : ""} — {entry.driver}
                          {entry.navigator ? ` / ${entry.navigator}` : ""}
                        </div>
                        <div className="text-xs text-neutral-500">{entry.carModelYear}</div>
                      </div>
                      <button
                        onClick={() => addCar(entry)}
                        className="shrink-0 bg-neutral-800 hover:bg-emerald-700 text-sm px-3 py-1.5 rounded-md"
                      >
                        Add →
                      </button>
                    </div>
                  ))}
                  {filteredAvailable.length === 0 && (
                    <p className="px-4 py-6 text-center text-neutral-500">
                      {entries.length === 0 ? "No entries." : "All matching entries are already tracked."}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Right: tracked cars with per-alert checkboxes */}
            <div>
              <h2 className="text-lg font-semibold mb-2">Tracked ({tracked.size})</h2>
              <div className="border border-neutral-800 rounded-lg divide-y divide-neutral-800 max-h-[60vh] overflow-y-auto">
                {Array.from(tracked.values()).map((car) => (
                  <div key={car.entryId} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">
                          #{car.identifier}
                          {car.carClass ? ` (${car.carClass})` : ""} — {car.driver}
                          {car.navigator ? ` / ${car.navigator}` : ""}
                        </div>
                        <div className="text-xs text-neutral-500">{car.carModelYear}</div>
                      </div>
                      <button
                        onClick={() => removeCar(car.entryId)}
                        className="shrink-0 text-red-400 hover:text-red-300 text-sm px-2"
                      >
                        ✕ Remove
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                      {ALERT_LABELS.map((a) => (
                        <label key={a.key} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-emerald-500"
                            checked={car.alerts[a.key] ?? false}
                            onChange={() => toggleAlert(car.entryId, a.key)}
                          />
                          {a.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {tracked.size === 0 && (
                  <p className="px-4 py-6 text-center text-neutral-500">
                    Click &quot;Add →&quot; on the left to start tracking cars.
                  </p>
                )}
              </div>
            </div>
          </section>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg py-3"
          >
            {saving ? "Saving…" : "Save & start tracking"}
          </button>
          {saveMessage && (
            <p className="text-center text-sm mt-2 text-neutral-300">{saveMessage}</p>
          )}

          <p className="text-center text-xs text-neutral-500 mt-4">
            Once saved, text HELP to the alert number for ad-hoc commands (overall time check,
            stage time check, class-only comparisons).
          </p>
        </>
      )}

      {showConfirmPopup && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
          onClick={() => setShowConfirmPopup(false)}
        >
          <div
            className="bg-neutral-900 border border-neutral-700 rounded-xl p-6 max-w-sm w-full text-center"
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
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg px-4 py-2 w-full"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { getDeviceId, getSavedPhone, savePhoneLocally } from "@/lib/device";

interface RSEvent {
  eventId: number;
  name: string;
  countryCode?: string;
  startDate?: string;
  endDate?: string;
}

interface RSEntrySlim {
  entryId: number;
  identifier: string;
  classText?: string;
  driver: string;
  navigator: string | null;
  make?: string;
}

export default function Home() {
  const [deviceId, setDeviceId] = useState("");
  const [phone, setPhone] = useState("");
  const [events, setEvents] = useState<RSEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<RSEvent | null>(null);
  const [entries, setEntries] = useState<RSEntrySlim[]>([]);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<number>>(new Set());
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const id = getDeviceId();
    setDeviceId(id);
    setPhone(getSavedPhone());
  }, []);

  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoadingEvents(false));
  }, []);

  // When an event is selected, load entries and any existing saved subscriptions
  useEffect(() => {
    if (!selectedEvent || !deviceId) return;
    setLoadingEntries(true);
    setSelectedEntryIds(new Set());

    Promise.all([
      fetch(`/api/events/${selectedEvent.eventId}/entries`).then((r) => r.json()),
      fetch(`/api/subscriptions?deviceId=${deviceId}`).then((r) => r.json()),
    ])
      .then(([entriesData, subsData]) => {
        setEntries(entriesData.entries ?? []);
        const existing: { eventId: number; entryId: number }[] = subsData.subscriptions ?? [];
        const forThisEvent = existing
          .filter((s) => s.eventId === selectedEvent.eventId)
          .map((s) => s.entryId);
        setSelectedEntryIds(new Set(forThisEvent));
        if (subsData.device?.phone) {
          setPhone(subsData.device.phone);
        }
      })
      .finally(() => setLoadingEntries(false));
  }, [selectedEvent, deviceId]);

  const toggleEntry = useCallback((entryId: number) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
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
          entryIds: Array.from(selectedEntryIds),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveMessage(data.error ?? "Failed to save.");
      } else {
        savePhoneLocally(data.phone);
        setPhone(data.phone);
        setSaveMessage(`Saved! Watching ${selectedEntryIds.size} car(s).`);
      }
    } catch {
      setSaveMessage("Network error saving subscriptions.");
    } finally {
      setSaving(false);
    }
  };

  const filteredEntries = entries.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.identifier.toLowerCase().includes(q) ||
      e.driver.toLowerCase().includes(q) ||
      (e.navigator ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6 max-w-3xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">🏁 RallySafe Paranoia</h1>
        <p className="text-neutral-400 mt-1">
          Get a text if someone you&apos;re watching stops moving on stage for 3+ minutes.
        </p>
      </header>

      <section className="mb-8">
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
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 text-neutral-100"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="text-xs text-neutral-500 mt-1">
              Saved to this device — you won&apos;t need to re-enter it here next time.
            </p>
          </section>

          <section className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">3. Select who to track</h2>
              <span className="text-sm text-neutral-400">
                {selectedEntryIds.size} selected
              </span>
            </div>
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
              <div className="border border-neutral-800 rounded-lg divide-y divide-neutral-800 max-h-[50vh] overflow-y-auto">
                {filteredEntries.map((entry) => (
                  <label
                    key={entry.entryId}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="w-5 h-5 accent-emerald-500"
                      checked={selectedEntryIds.has(entry.entryId)}
                      onChange={() => toggleEntry(entry.entryId)}
                    />
                    <div className="flex-1">
                      <div className="font-medium">
                        #{entry.identifier} — {entry.driver}
                        {entry.navigator ? ` / ${entry.navigator}` : ""}
                      </div>
                      <div className="text-xs text-neutral-500">
                        {entry.classText} {entry.make ? `· ${entry.make}` : ""}
                      </div>
                    </div>
                  </label>
                ))}
                {filteredEntries.length === 0 && (
                  <p className="px-4 py-6 text-center text-neutral-500">No entries match.</p>
                )}
              </div>
            )}
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
        </>
      )}
    </div>
  );
}

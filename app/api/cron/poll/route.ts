import { NextRequest, NextResponse } from "next/server";
import { getEntries } from "@/lib/rallysafe";
import {
  getActiveEventIds,
  getWatchedEntryIds,
  getState,
  setState,
  getSubscribersForEntry,
  getDevice,
  type LastKnownState,
} from "@/lib/store";
import { sendSms } from "@/lib/sms";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STOPPED_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
// A car is "moving" if it has covered more than this many degrees of
// lat/lng since the last poll (~this is roughly 3-5 meters — RallySafe GPS
// jitter is small but nonzero, so we don't rely on exact equality).
const POSITION_EPSILON = 0.00003;

function movedSincePrev(prev: LastKnownState, lat: number, lng: number, speed: number): boolean {
  if (speed > 1) return true; // moving faster than ~1 unit/hr-equivalent -> definitely moving
  const dLat = Math.abs(lat - prev.lat);
  const dLng = Math.abs(lng - prev.lng);
  return dLat > POSITION_EPSILON || dLng > POSITION_EPSILON;
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown>[] = [];
  const activeEventIds = await getActiveEventIds();

  for (const eventId of activeEventIds) {
    const watchedEntryIds = await getWatchedEntryIds(eventId);
    if (watchedEntryIds.length === 0) continue;

    let entries;
    try {
      entries = await getEntries(eventId);
    } catch (err) {
      console.error(`Failed to fetch entries for event ${eventId}`, err);
      continue;
    }

    const byEntryId = new Map(entries.map((e) => [e.entryId, e]));

    for (const entryId of watchedEntryIds) {
      const live = byEntryId.get(entryId);
      if (!live) continue;

      const prev = await getState(eventId, entryId);
      const now = Date.now();

      const isMoving = prev ? movedSincePrev(prev, live.lat, live.lng, live.speed) : live.speed > 1;

      let stoppedSinceTs: number | null;
      let alertSentForThisStop: boolean;

      if (isMoving) {
        stoppedSinceTs = null;
        alertSentForThisStop = false;
      } else {
        stoppedSinceTs = prev?.stoppedSinceTs ?? now;
        alertSentForThisStop = prev?.alertSentForThisStop ?? false;
      }

      const stoppedDurationMs = stoppedSinceTs ? now - stoppedSinceTs : 0;
      const shouldAlert =
        !isMoving && stoppedDurationMs >= STOPPED_THRESHOLD_MS && !alertSentForThisStop;

      if (shouldAlert) {
        const subscriberIds = await getSubscribersForEntry(eventId, entryId);
        const driverName = live.vehicle?.driver
          ? `${live.vehicle.driver.firstName} ${live.vehicle.driver.surname}`
          : "Unknown driver";
        const minutesStopped = Math.round(stoppedDurationMs / 60000);
        const mapsLink = `https://maps.google.com/?q=${live.lat},${live.lng}`;
        const msg =
          `RallySafe Paranoia alert:\n` +
          `Car #${live.identifier} (${driverName}) has not moved for ${minutesStopped}+ min.\n` +
          `Last known location: ${mapsLink}`;

        for (const deviceId of subscriberIds) {
          const device = await getDevice(deviceId);
          if (!device?.phone) continue;
          try {
            await sendSms(device.phone, msg);
          } catch (err) {
            console.error(`Failed to SMS device ${deviceId}`, err);
          }
        }
        alertSentForThisStop = true;
        results.push({ eventId, entryId, alerted: true, subscriberCount: subscriberIds.length });
      }

      await setState({
        entryId,
        eventId,
        lat: live.lat,
        lng: live.lng,
        speed: live.speed,
        lastMessageTimestamp: live.lastMessageTimestamp,
        stoppedSinceTs,
        alertSentForThisStop,
      });
    }
  }

  return NextResponse.json({ ok: true, checked: results.length, results });
}

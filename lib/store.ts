import { Redis } from "@upstash/redis";

// Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from env.
// Set these in Vercel project settings (Upstash integration sets them automatically
// if you use the Vercel Marketplace add-on, otherwise paste them manually).
export const redis = Redis.fromEnv();

export interface DeviceProfile {
  deviceId: string;
  phone: string; // E.164 format, e.g. +13145551234
  createdAt: number;
  updatedAt: number;
}

export interface Subscription {
  deviceId: string;
  eventId: number;
  entryId: number; // RallySafe entry id being watched
  createdAt: number;
}

export interface LastKnownState {
  entryId: number;
  eventId: number;
  lat: number;
  lng: number;
  speed: number;
  lastMessageTimestamp: string;
  stoppedSinceTs: number | null; // ms epoch when this entry was first observed stationary
  alertSentForThisStop: boolean;
}

const k = {
  device: (id: string) => `device:${id}`,
  subsByDevice: (id: string) => `subs:device:${id}`,
  subsByEntry: (eventId: number, entryId: number) => `subs:entry:${eventId}:${entryId}`,
  state: (eventId: number, entryId: number) => `state:${eventId}:${entryId}`,
  activeEvents: "active-events",
};

export async function saveDevice(profile: DeviceProfile) {
  await redis.set(k.device(profile.deviceId), profile);
}

export async function getDevice(deviceId: string): Promise<DeviceProfile | null> {
  return redis.get<DeviceProfile>(k.device(deviceId));
}

export async function setSubscriptions(deviceId: string, eventId: number, entryIds: number[]) {
  // Read the device's previous subscriptions so we can clean up reverse-index entries
  const prev = (await redis.smembers(k.subsByDevice(deviceId))) as string[];
  const prevEntryIds = prev
    .filter((s) => s.startsWith(`${eventId}:`))
    .map((s) => Number(s.split(":")[1]));

  const pipeline = redis.pipeline();

  // Remove stale reverse-index entries for this event
  for (const oldEntryId of prevEntryIds) {
    if (!entryIds.includes(oldEntryId)) {
      pipeline.srem(k.subsByEntry(eventId, oldEntryId), deviceId);
      pipeline.srem(k.subsByDevice(deviceId), `${eventId}:${oldEntryId}`);
    }
  }

  // Add new ones
  for (const entryId of entryIds) {
    pipeline.sadd(k.subsByEntry(eventId, entryId), deviceId);
    pipeline.sadd(k.subsByDevice(deviceId), `${eventId}:${entryId}`);
  }

  pipeline.sadd(k.activeEvents, String(eventId));
  await pipeline.exec();

  // Keep the per-event watched-entries set in sync (used by the cron poller so it
  // only bothers checking cars someone actually cares about).
  const stillWatched = new Set(prevEntryIds.filter((id) => entryIds.includes(id)).concat(entryIds));
  for (const oldEntryId of prevEntryIds) {
    if (!entryIds.includes(oldEntryId)) {
      const remainingSubs = await getSubscribersForEntry(eventId, oldEntryId);
      if (remainingSubs.length === 0) {
        await removeWatchedEntry(eventId, oldEntryId);
      }
    }
  }
  for (const entryId of stillWatched) {
    await addWatchedEntry(eventId, entryId);
  }
}

export async function getDeviceSubscriptions(deviceId: string): Promise<{ eventId: number; entryId: number }[]> {
  const raw = (await redis.smembers(k.subsByDevice(deviceId))) as string[];
  return raw.map((s) => {
    const [eventId, entryId] = s.split(":").map(Number);
    return { eventId, entryId };
  });
}

export async function getSubscribersForEntry(eventId: number, entryId: number): Promise<string[]> {
  return (await redis.smembers(k.subsByEntry(eventId, entryId))) as string[];
}

export async function getActiveEventIds(): Promise<number[]> {
  const raw = (await redis.smembers(k.activeEvents)) as string[];
  return raw.map(Number);
}

/** Returns the set of entryIds that have at least one subscriber, for a given event. */
export async function getWatchedEntryIds(eventId: number): Promise<number[]> {
  // Scan the subs:device:* sets isn't efficient; instead we keep a per-event watched set.
  const key = `watched:${eventId}`;
  return ((await redis.smembers(key)) as string[]).map(Number);
}

export async function addWatchedEntry(eventId: number, entryId: number) {
  await redis.sadd(`watched:${eventId}`, String(entryId));
}

export async function removeWatchedEntry(eventId: number, entryId: number) {
  await redis.srem(`watched:${eventId}`, String(entryId));
}

export async function getState(eventId: number, entryId: number): Promise<LastKnownState | null> {
  return redis.get<LastKnownState>(k.state(eventId, entryId));
}

export async function setState(state: LastKnownState) {
  // TTL of 24h — event data is meaningless after the weekend is over.
  await redis.set(k.state(state.eventId, state.entryId), state, { ex: 60 * 60 * 24 });
}

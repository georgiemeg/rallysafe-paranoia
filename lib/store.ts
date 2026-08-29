import { Redis } from "@upstash/redis";

// Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from env.
export const redis = Redis.fromEnv();

export interface DeviceProfile {
  deviceId: string;
  phone: string; // E.164 format, e.g. +13145551234
  createdAt: number;
  updatedAt: number;
}

export const ALERT_TYPES = [
  "stageStart",
  "stageFinish",
  "stageTimes",
  "overallTime",
  "incidentDetection",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export interface CarSubscription {
  deviceId: string;
  eventId: number; // live-tracking eventId (rc.statusas.com)
  entryId: number; // live-tracking entryId for this car
  carNumber: string;
  driverName: string;
  codriverName: string;
  carClass: string;
  carModelYear: string; // e.g. "1977 Ford Escort"
  alerts: Record<AlertType, boolean>;
  classScopeOnly: boolean; // false = "all classes" comparisons, true = "class only"
  createdAt: number;
  updatedAt: number;
}

export interface LiveTrackState {
  entryId: number;
  eventId: number;
  lat: number;
  lng: number;
  speed: number;
  lastMessageTimestamp: string;
  stoppedSinceTs: number | null;
  alertSentForThisStop: boolean;
  lastKnownStageNumber: number; // 0 = not on stage
  lastKnownRacingStatus: number;
}

/** Tracks which stage numbers we've already sent a "stage times"/"overall time" alert for,
 * per car, so we don't resend on every poll tick once results are in. */
export interface ResultsSentState {
  entryId: number;
  eventId: number;
  stageTimesSentForStage: number[]; // stage numbers already alerted
  overallSentForStage: number[];
}

const k = {
  device: (id: string) => `device:${id}`,
  carSub: (eventId: number, entryId: number) => `carsub:${eventId}:${entryId}`,
  subsByDevice: (id: string) => `subs:device:${id}`, // set of "eventId:entryId"
  subscribersForEntry: (eventId: number, entryId: number) => `subscribers:${eventId}:${entryId}`,
  liveState: (eventId: number, entryId: number) => `livestate:${eventId}:${entryId}`,
  resultsState: (eventId: number, entryId: number) => `resultsstate:${eventId}:${entryId}`,
  activeEvents: "active-events",
  watchedEntries: (eventId: number) => `watched:${eventId}`,
};

export async function saveDevice(profile: DeviceProfile) {
  await redis.set(k.device(profile.deviceId), profile);
  await indexPhone(profile.phone, profile.deviceId);
}

export async function getDevice(deviceId: string): Promise<DeviceProfile | null> {
  return redis.get<DeviceProfile>(k.device(deviceId));
}

export async function findDeviceByPhone(phone: string): Promise<DeviceProfile | null> {
  // Devices are keyed by deviceId, not phone, so inbound SMS (which only carries the phone
  // number) needs a reverse lookup. We maintain a small phone->deviceId index for this.
  const deviceId = await redis.get<string>(`phone-index:${phone}`);
  if (!deviceId) return null;
  return getDevice(deviceId);
}

async function indexPhone(phone: string, deviceId: string) {
  await redis.set(`phone-index:${phone}`, deviceId);
}

/**
 * Replace ALL of a device's car subscriptions for one event in a single save
 * (this backs the one "Save & start tracking" button covering every car + toggle at once).
 */
export async function saveSubscriptionsForEvent(
  deviceId: string,
  eventId: number,
  cars: Omit<CarSubscription, "deviceId" | "eventId" | "createdAt" | "updatedAt">[]
) {
  const now = Date.now();

  // Find and clean up previous subscriptions for this device+event that are no longer present
  const prevKeys = (await redis.smembers(k.subsByDevice(deviceId))) as string[];
  const prevEntryIdsThisEvent = prevKeys
    .filter((s) => s.startsWith(`${eventId}:`))
    .map((s) => Number(s.split(":")[1]));

  const newEntryIds = cars.map((c) => c.entryId);
  const pipeline = redis.pipeline();

  for (const oldEntryId of prevEntryIdsThisEvent) {
    if (!newEntryIds.includes(oldEntryId)) {
      pipeline.srem(k.subscribersForEntry(eventId, oldEntryId), deviceId);
      pipeline.srem(k.subsByDevice(deviceId), `${eventId}:${oldEntryId}`);
      pipeline.del(k.carSub(eventId, oldEntryId) + `:${deviceId}`);
    }
  }

  for (const car of cars) {
    const sub: CarSubscription = {
      ...car,
      deviceId,
      eventId,
      createdAt: now,
      updatedAt: now,
    };
    // Per-device-per-car record (different devices watching the same car can have
    // different alert-type selections)
    pipeline.set(`${k.carSub(eventId, car.entryId)}:${deviceId}`, sub);
    pipeline.sadd(k.subscribersForEntry(eventId, car.entryId), deviceId);
    pipeline.sadd(k.subsByDevice(deviceId), `${eventId}:${car.entryId}`);
    pipeline.sadd(k.watchedEntries(eventId), String(car.entryId));
  }

  pipeline.sadd(k.activeEvents, String(eventId));
  await pipeline.exec();
}

export async function getDeviceSubscriptionsForEvent(
  deviceId: string,
  eventId: number
): Promise<CarSubscription[]> {
  const keys = (await redis.smembers(k.subsByDevice(deviceId))) as string[];
  const entryIds = keys
    .filter((s) => s.startsWith(`${eventId}:`))
    .map((s) => Number(s.split(":")[1]));
  const subs = await Promise.all(
    entryIds.map((entryId) => redis.get<CarSubscription>(`${k.carSub(eventId, entryId)}:${deviceId}`))
  );
  return subs.filter((s): s is CarSubscription => s !== null);
}

export async function getAllDeviceSubscriptions(deviceId: string): Promise<CarSubscription[]> {
  const keys = (await redis.smembers(k.subsByDevice(deviceId))) as string[];
  const subs = await Promise.all(
    keys.map((s) => {
      const [eventId, entryId] = s.split(":").map(Number);
      return redis.get<CarSubscription>(`${k.carSub(eventId, entryId)}:${deviceId}`);
    })
  );
  return subs.filter((s): s is CarSubscription => s !== null);
}

export async function getSubscribersForCar(eventId: number, entryId: number): Promise<string[]> {
  return (await redis.smembers(k.subscribersForEntry(eventId, entryId))) as string[];
}

export async function getCarSubscription(
  eventId: number,
  entryId: number,
  deviceId: string
): Promise<CarSubscription | null> {
  return redis.get<CarSubscription>(`${k.carSub(eventId, entryId)}:${deviceId}`);
}

export async function updateClassScope(
  eventId: number,
  entryId: number,
  deviceId: string,
  classScopeOnly: boolean
): Promise<CarSubscription | null> {
  const existing = await getCarSubscription(eventId, entryId, deviceId);
  if (!existing) return null;
  const updated = { ...existing, classScopeOnly, updatedAt: Date.now() };
  await redis.set(`${k.carSub(eventId, entryId)}:${deviceId}`, updated);
  return updated;
}

export async function getActiveEventIds(): Promise<number[]> {
  return ((await redis.smembers(k.activeEvents)) as string[]).map(Number);
}

export async function getWatchedEntryIds(eventId: number): Promise<number[]> {
  return ((await redis.smembers(k.watchedEntries(eventId))) as string[]).map(Number);
}

export async function getLiveState(eventId: number, entryId: number): Promise<LiveTrackState | null> {
  return redis.get<LiveTrackState>(k.liveState(eventId, entryId));
}

export async function setLiveState(state: LiveTrackState) {
  await redis.set(k.liveState(state.eventId, state.entryId), state, { ex: 60 * 60 * 24 });
}

export async function getResultsSentState(
  eventId: number,
  entryId: number
): Promise<ResultsSentState | null> {
  return redis.get<ResultsSentState>(k.resultsState(eventId, entryId));
}

export async function setResultsSentState(state: ResultsSentState) {
  await redis.set(k.resultsState(state.eventId, state.entryId), state, { ex: 60 * 60 * 24 });
}

export { indexPhone };

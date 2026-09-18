import { Redis } from "@upstash/redis";

// Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from env.
export const redis = Redis.fromEnv();

export interface DeviceProfile {
  deviceId: string;
  phone: string; // E.164 format, e.g. +131****1234
  createdAt: number;
  updatedAt: number;
  smsEnabled?: boolean;
  smsConsentAt?: number; // mirror of phone-level consent, kept for the in-app settings UI
  smsConsentIp?: string;
}

/** Twilio-required opt-in evidence, keyed by PHONE NUMBER (not device) so consent
 * persists across browsers/devices and a new number always has to opt in again. */
export interface PhoneConsent {
  phone: string;
  consentedAt: number;
  consentIp?: string;
}

export const ALERT_TYPES = [
  "stageStart",
  "stageFinish",
  "stageTimes",
  "overallTime",
  "incidentDetection",
  "serviceEstimates",
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

/** One delivered alert, kept for the in-app inbox (an alternative to SMS for people who'd
 * rather view alerts inside the app instead of getting texts). Every alert that would be
 * sent via SMS also gets appended here, per-device, so nothing is missed either way. */
export interface InboxMessage {
  id: string;
  deviceId: string;
  eventId: number;
  entryId: number;
  carNumber: string;
  alertType: AlertType | "test" | "setup" | "command";
  body: string;
  createdAt: number;
}

export interface LiveTrackState {
  entryId: number;
  eventId: number;
  lat: number;
  lng: number;
  speed: number;
  lastMessageTimestamp: string;
  stoppedSinceTs: number | null;
  stopOriginLat: number | null;
  stopOriginLng: number | null;
  alertSentForThisStop: boolean;
  incidentQualifyCount: number;
  lastKnownStageNumber: number; // 0 = not on stage
  lastKnownRacingStatus: number;
  /** When a raw racingStatus 1→0 edge is seen, we hold the stage number here for one
   * poll to confirm it wasn't a blip before firing the finish alert. */
  pendingFinishStage?: number;
}

/** Tracks which stage numbers we've already sent a "stage times"/"overall time" alert for,
 * per car, so we don't resend on every poll tick once results are in. */
export interface ResultsSentState {
  entryId: number;
  eventId: number;
  stageTimesSentForStage: number[]; // stage numbers already alerted
  overallSentForStage: number[];
  serviceSentForStage?: number[];
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
  inbox: (deviceId: string) => `inbox:${deviceId}`,
};

export async function pushInbox(msg: InboxMessage) {
  await redis.lpush(k.inbox(msg.deviceId), msg);
  await redis.ltrim(k.inbox(msg.deviceId), 0, 99);
}

export async function listInbox(deviceId: string): Promise<InboxMessage[]> {
  const items = await redis.lrange<InboxMessage>(k.inbox(deviceId), 0, 99);
  return (items ?? []).filter(Boolean);
}

export async function saveDevice(profile: DeviceProfile) {
  await redis.set(k.device(profile.deviceId), profile);
  await indexPhone(profile.phone, profile.deviceId);
}

export async function getPhoneConsent(phone: string): Promise<PhoneConsent | null> {
  return redis.get<PhoneConsent>(`phone-consent:${phone}`);
}

export async function recordPhoneConsent(phone: string, ip?: string): Promise<PhoneConsent> {
  const record: PhoneConsent = { phone, consentedAt: Date.now(), consentIp: ip };
  await redis.set(`phone-consent:${phone}`, record);
  return record;
}

export async function revokePhoneConsent(phone: string): Promise<void> {
  await redis.del(`phone-consent:${phone}`);
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
  await redis.sadd(`phone-devices:${phone}`, deviceId);
}

export async function deviceIdsForPhone(phone: string): Promise<string[]> {
  const ids = ((await redis.smembers(`phone-devices:${phone}`)) as string[]) || [];
  const primary = await redis.get<string>(`phone-index:${phone}`);
  return Array.from(new Set([...ids, ...(primary ? [primary] : [])]));
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

  if (cars.length === 0) {
    for (const oldEntryId of prevEntryIdsThisEvent) {
      const left = await redis.scard(k.subscribersForEntry(eventId, oldEntryId));
      if (!left) await redis.srem(k.watchedEntries(eventId), String(oldEntryId));
    }
  }
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

const SYSTEM_PAUSED_KEY = "system:paused";

/** Global kill switch for background CPU (cron poller, simulator tick, Sportity scanner).
 * Toggled from the owner Dev Tools. While paused the cron endpoints return immediately
 * without doing any work, so the app burns ~zero Vercel Fluid compute. */
export async function isSystemPaused(): Promise<boolean> {
  return (await redis.get<string>(SYSTEM_PAUSED_KEY)) === "1";
}

export async function setSystemPaused(paused: boolean): Promise<void> {
  if (paused) await redis.set(SYSTEM_PAUSED_KEY, "1");
  else await redis.del(SYSTEM_PAUSED_KEY);
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

/** First caller wins. Stops duplicate start/finish texts when ticks overlap. */
export async function claimAlert(key: string): Promise<boolean> {
  const out = await redis.set(key, "1", { nx: true, ex: 60 * 60 * 24 * 14 });
  return Boolean(out);
}

export async function clearAlertClaims(eventId: number) {
  const needle = `:${eventId}:`;
  let cursor = 0;
  do {
    const res = (await redis.scan(cursor, { count: 200 })) as [string | number, string[]];
    cursor = Number(res[0]);
    const batch = res[1] || [];
    const hit = batch.filter((k) => k.includes(needle) && (k.startsWith("alert:") || k.startsWith("telegram:")));
    if (hit.length) await redis.del(...hit);
  } while (cursor !== 0);
}

export async function clearLiveState(eventId: number) {
  const prefix = `livestate:${eventId}:`;
  let cursor = 0;
  do {
    const res = (await redis.scan(cursor, { count: 200 })) as [string | number, string[]];
    cursor = Number(res[0]);
    const hit = (res[1] || []).filter((key) => key.startsWith(prefix));
    if (hit.length) await redis.del(...hit);
  } while (cursor !== 0);
}

/** Clears the "already sent" dedupe markers for stage times / overall / service alerts.
 * Without this, restarting the sim leaves stale resultsstate keys behind (e.g. stages 1-4
 * marked sent from a prior run) and every real alert on a re-run silently gets treated as
 * a duplicate and dropped — this is why stage/overall alerts stopped firing after a restart
 * even though start/finish alerts (which don't use this dedupe) kept working. */
export async function clearResultsSentState(eventId: number) {
  const prefix = `resultsstate:${eventId}:`;
  let cursor = 0;
  do {
    const res = (await redis.scan(cursor, { count: 200 })) as [string | number, string[]];
    cursor = Number(res[0]);
    const hit = (res[1] || []).filter((key) => key.startsWith(prefix));
    if (hit.length) await redis.del(...hit);
  } while (cursor !== 0);
}

export { indexPhone };

export async function watchEntry(eventId: number, entryId: number) {
  await redis.sadd(k.activeEvents, String(eventId));
  await redis.sadd(k.watchedEntries(eventId), String(entryId));
}

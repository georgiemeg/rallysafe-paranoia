// Thin client for the public RallySafe / RaceControl (statusas.com) data feed.
// The API requires an anonymous "PublicUser" session cookie (issued by /identity)
// on every request — it's not a real API key, just an anti-scraping session token,
// but it must be present or every call 401s. We fetch + cache it for a short window
// since serverless invocations don't share a cookie jar across requests.
const BASE = "https://rc.statusas.com";

let cachedCookie: string | null = null;
let cachedCookieAt = 0;
const COOKIE_TTL_MS = 10 * 60 * 1000; // re-fetch every 10 min to stay safe

async function getIdentityCookie(): Promise<string> {
  const now = Date.now();
  if (cachedCookie && now - cachedCookieAt < COOKIE_TTL_MS) {
    return cachedCookie;
  }
  const res = await fetch(`${BASE}/identity`, { cache: "no-store" });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("RallySafe identity endpoint did not return a session cookie");
  }
  // There may be multiple Set-Cookie headers folded together depending on runtime;
  // res.headers.get only returns the first on some platforms. Split defensively.
  const cookiePairs = setCookie
    .split(/,(?=[^;]+?=)/) // split on commas that start a new "name=value" pair
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean);
  cachedCookie = cookiePairs.join("; ");
  cachedCookieAt = now;
  return cachedCookie;
}

export interface RSEvent {
  eventId: number;
  name: string;
  countryCode?: string;
  startDate?: string;
  endDate?: string;
  status?: number; // 1 = live/upcoming per event/table filters
  [key: string]: unknown;
}

export interface RSPerson {
  personId: number;
  countryCode?: string;
  firstName: string;
  surname: string;
}

export interface RSVehicle {
  vehicleId: number;
  driverId: number;
  driver: RSPerson;
  navigatorId?: number;
  navigator?: RSPerson;
  make?: string;
}

export interface RSEntry {
  entryId: number;
  eventId: number;
  eventName: string;
  identifier: string; // car number
  classText?: string;
  vehicle: RSVehicle;
  lat: number;
  lng: number;
  bearing: number;
  speed: number;
  lastMessageTimestamp: string;
  isUnitActive: boolean;
  stageNumber: number;
  racingStatus: number;
  [key: string]: unknown;
}

export async function rsFetch<T>(path: string): Promise<T> {
  const cookie = await getIdentityCookie();
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json", Cookie: cookie },
    // Always hit the network — this is live telemetry, never cache.
    cache: "no-store",
  });
  if (res.status === 401) {
    // Cookie may have expired server-side even within our TTL window — retry once fresh.
    cachedCookie = null;
    const retryCookie = await getIdentityCookie();
    const retryRes = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json", Cookie: retryCookie },
      cache: "no-store",
    });
    if (!retryRes.ok) {
      throw new Error(`RallySafe fetch failed: ${path} -> ${retryRes.status}`);
    }
    return retryRes.json() as Promise<T>;
  }
  if (!res.ok) {
    throw new Error(`RallySafe fetch failed: ${path} -> ${res.status}`);
  }
  return res.json() as Promise<T>;
}


/** List events. Status=1 filters to current/live+upcoming per the site's own default query. */
export async function listEvents(params?: {
  skip?: number;
  take?: number;
  search?: string;
}): Promise<RSEvent[]> {
  const skip = params?.skip ?? 0;
  const take = params?.take ?? 50;
  const search = encodeURIComponent(params?.search ?? "");
  return rsFetch<RSEvent[]>(
    `/event/table?skip=${skip}&take=${take}&search=${search}&order=desc&phaseStart=1&phaseEnd=5&status=1&champs=&countries=`
  );
}

/** Full entry list (car #, driver, co-driver, live lat/lng/speed) for an event. */
export async function getEntries(eventId: number): Promise<RSEntry[]> {
  return rsFetch<RSEntry[]>(
    `/entry/table?search=&order=&eventId=${eventId}&classes=`
  );
}

export async function getEventDetails(eventId: number) {
  return rsFetch<RSEvent>(`/event/details?eventId=${eventId}`);
}

export interface RSStage {
  locationGroupId: number;
  eventId: number;
  number: number;
  name: string;
  length: number;
  isTransit: boolean;
  status: number; // 4 = completed, seen empirically
  order: number;
}

/** Human-readable stage list (SS1 Crossroads etc) with mile length and completion status. */
export async function listStages(eventId: number): Promise<RSStage[]> {
  return rsFetch<RSStage[]>(`/itinerary/stages?eventId=${eventId}&includePolyline=false`);
}

/**
 * Extracts the Results API eventId (a completely different numbering scheme than the
 * live-tracking eventId) from the event's resultsUrl field, e.g.
 * "https://results.statusas.com/events/625/stagetimes" -> 625.
 */
export async function getResultsEventId(eventId: number): Promise<number | null> {
  const details = await getEventDetails(eventId);
  const url = (details as { resultsUrl?: string }).resultsUrl;
  if (!url) return null;
  const match = url.match(/\/events\/(\d+)\//);
  return match ? Number(match[1]) : null;
}

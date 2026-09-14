export type CloudCar = {
  entryId: number;
  identifier: string;
  driver: string;
  navigator?: string | null;
  carClass: string;
  carModelYear?: string;
  alerts?: Record<string, boolean>;
};

export type CloudPrefs = {
  smsEnabled: boolean;
  classScopeOnly: boolean;
};

export type CloudEvent = {
  eventId: number;
  eventName: string;
  savedAt: number;
  cars: CloudCar[];
};

export type CloudBlob = {
  eventId?: number;
  eventName?: string;
  phone?: string;
  cars?: CloudCar[];
  history?: CloudEvent[];
  prefs?: Partial<CloudPrefs>;
};

export const defaultPrefs = (): CloudPrefs => ({
  smsEnabled: true,
  classScopeOnly: false,
});

function asBlob(raw: unknown): CloudBlob {
  if (!raw || typeof raw !== "object") return {};
  return raw as CloudBlob;
}

export function mergeCloud(prevRaw: unknown, incomingRaw: unknown): CloudBlob {
  const prev = asBlob(prevRaw);
  const incoming = asBlob(incomingRaw);
  const history = [...(prev.history ?? [])];
  const eventId = incoming.eventId ?? prev.eventId;
  const eventName = incoming.eventName ?? prev.eventName ?? "";
  const cars = incoming.cars ?? prev.cars ?? [];

  if (incoming.eventId && incoming.cars) {
    const nextEv: CloudEvent = {
      eventId: incoming.eventId,
      eventName: incoming.eventName ?? "",
      savedAt: Date.now(),
      cars: incoming.cars,
    };
    const idx = history.findIndex((h) => h.eventId === incoming.eventId);
    if (idx >= 0) history[idx] = nextEv;
    else history.push(nextEv);
  }

  return {
    eventId,
    eventName,
    phone: incoming.phone ?? prev.phone,
    cars,
    history,
    prefs: { ...defaultPrefs(), ...prev.prefs, ...incoming.prefs },
  };
}

function mode(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

export type ProfileStats = {
  memberSince: number;
  lastLoginAt: number | null;
  currentRally: string;
  carsThisRally: number;
  ralliesFollowed: number;
  uniqueCars: number;
  mostTrackedCrew: string;
  favoriteClass: string;
  alertsArmed: string;
};

export function computeProfileStats(opts: {
  createdAt: number;
  lastLoginAt: number | null;
  cloud: unknown;
}): ProfileStats {
  const cloud = asBlob(opts.cloud);
  const history = cloud.history ?? [];
  const currentCars = cloud.cars ?? [];
  const allCars = history.length ? history.flatMap((h) => h.cars) : currentCars;

  const crews = allCars.map((c) => {
    const nav = (c.navigator ?? "").trim();
    return nav ? `${c.driver} / ${nav}` : c.driver;
  }).filter(Boolean);

  const classes = allCars.map((c) => c.carClass).filter(Boolean);
  const numbers = new Set(allCars.map((c) => String(c.identifier)).filter(Boolean));

  const alertNames: Record<string, string> = {
    stageStart: "Stage start",
    stageFinish: "Stage finish",
    stageTimes: "Stage times",
    overallTime: "Overall",
    incidentDetection: "Incident",
    serviceEstimates: "Service",
  };
  const alertCounts = new Map<string, number>();
  for (const car of currentCars) {
    for (const [k, on] of Object.entries(car.alerts ?? {})) {
      if (on) alertCounts.set(k, (alertCounts.get(k) ?? 0) + 1);
    }
  }
  const armed = [...alertCounts.entries()]
    .filter(([, n]) => n > 0)
    .map(([k]) => alertNames[k] ?? k);

  return {
    memberSince: opts.createdAt,
    lastLoginAt: opts.lastLoginAt,
    currentRally: cloud.eventName || (cloud.eventId ? `Event ${cloud.eventId}` : "None yet"),
    carsThisRally: currentCars.length,
    ralliesFollowed: history.length || (cloud.eventId ? 1 : 0),
    uniqueCars: numbers.size,
    mostTrackedCrew: mode(crews) ?? "None yet",
    favoriteClass: mode(classes) ?? "None yet",
    alertsArmed: armed.length ? armed.join(" · ") : "None yet",
  };
}

export function prefsFromCloud(cloud: unknown): CloudPrefs {
  const p = asBlob(cloud).prefs;
  return { ...defaultPrefs(), ...p };
}

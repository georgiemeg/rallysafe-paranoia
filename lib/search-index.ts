import { getEntries, listEvents } from "@/lib/rallysafe";
import { countryName } from "@/lib/person";

export type CrewRecord = {
  kind: "driver" | "codriver";
  label: string;
  sub: string;
  href: string;
  country: string;
  eventId: number;
  entryId: number;
  car: string;
};

type Cache = { at: number; crews: CrewRecord[] };

let cache: Cache | null = null;
const TTL_MS = 10 * 60 * 1000;
let inflight: Promise<CrewRecord[]> | null = null;

export async function getCrewIndex(): Promise<CrewRecord[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.crews;
  if (inflight) return inflight;
  inflight = build().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function build(): Promise<CrewRecord[]> {
  const events = await listEvents({ take: 12 });
  const packs = await Promise.all(
    events.slice(0, 6).map(async (ev) => {
      try {
        return { ev, entries: await getEntries(ev.eventId) };
      } catch {
        return { ev, entries: [] as Awaited<ReturnType<typeof getEntries>> };
      }
    })
  );
  const crews: CrewRecord[] = [];
  for (const { ev, entries } of packs) {
    for (const e of entries) {
      const car = e.identifier;
      const add = (
        kind: "driver" | "codriver",
        person: { firstName: string; surname: string; countryCode?: string } | undefined
      ) => {
        if (!person) return;
        const label = `${person.firstName} ${person.surname}`.trim();
        if (!label) return;
        const country = countryName(person.countryCode);
        crews.push({
          kind,
          label,
          sub: kind === "driver" ? `#${car} · ${ev.name}` : `#${car} co-driver · ${ev.name}`,
          href: `/people?kind=${kind}&name=${encodeURIComponent(label)}&car=${encodeURIComponent(car)}&event=${encodeURIComponent(ev.name)}&country=${encodeURIComponent(country)}`,
          country,
          eventId: ev.eventId,
          entryId: e.entryId,
          car,
        });
      };
      add("driver", e.vehicle?.driver);
      add("codriver", e.vehicle?.navigator);
    }
  }
  cache = { at: Date.now(), crews };
  return crews;
}

export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ł/gi, "l")
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae")
    .replace(/œ/gi, "oe")
    .replace(/ß/g, "ss")
    .replace(/đ/gi, "d")
    .replace(/ð/gi, "d")
    .replace(/þ/gi, "th")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDist(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[m];
}

function similarToken(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (long.startsWith(short) && short.length >= 3) return true;
  return a.length >= 4 && b.length >= 4 && editDist(a, b) <= 2;
}

export function scoreName(q: string, text: string): number {
  const a = foldName(q);
  const b = foldName(text);
  if (!a) return 0;
  if (b === a) return 100;
  const qParts = a.split(/\s+/).filter(Boolean);
  const nParts = b.split(/\s+/).filter(Boolean);
  const last = nParts[nParts.length - 1] ?? "";
  const first = nParts[0] ?? "";
  if (qParts.length === 1) {
    const p = qParts[0];
    if (last === p) return 95;
    if (first === p) return 88;
    if (similarToken(p, last)) return 84;
    if (similarToken(p, first)) return 76;
    if (nParts.some((n) => n.includes(p) || p.includes(n))) return 55;
    return 0;
  }
  const qLast = qParts[qParts.length - 1];
  const qFirst = qParts[0];
  const lastHit = similarToken(qLast, last) || similarToken(qFirst, last) || nParts.some((n) => similarToken(qLast, n));
  const firstHit =
    similarToken(qFirst, first) ||
    similarToken(qLast, first) ||
    qParts.some((p) => nParts.some((n) => n !== last && similarToken(p, n)));
  if (lastHit && firstHit) return 96;
  if (lastHit) return 80;
  const matched = qParts.every((p) => nParts.some((n) => similarToken(p, n)));
  if (!matched) return 0;
  return 78;
}

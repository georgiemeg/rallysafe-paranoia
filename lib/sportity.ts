import { Redis } from "@upstash/redis";
import { sendOwnerTelegram } from "@/lib/telegram";

const redis = Redis.fromEnv();

// The event bulletin page — organizers post bulletins, steward decisions, schedule
// changes and other live updates here. Overridable per event via env var.
const SPORTITY_URL =
  process.env.SPORTITY_BULLETIN_URL ||
  "https://webapp.sportity.com/event/OVRMTN2026/1f16be91-de1f-43e4-adf3-f8c848ebec7f";

const SEEN_KEY = "sportity:seen";
const CONFIGS_KEY = "event-configs"; // Redis hash: config name -> JSON EventConfig
const ACTIVE_KEY = "event-config:active";

export interface EventConfig {
  name: string;
  /** Sportity bulletin page URL for this event. */
  bulletinUrl?: string;
  /** Comma-separated service durations, e.g. "60,60,30" = service 1: 60min, 2: 60min, 3: 30min. */
  serviceDurationsCsv?: string;
  /** Comma-separated stage numbers after which a service occurs, e.g. "2,7,10" means
   * service 1 follows stage 2, service 2 follows stage 7, service 3 follows stage 10. */
  serviceAfterStagesCsv?: string;
  createdAt: number;
  updatedAt: number;
}

/** All saved configs, most-recently-updated first. Nothing is ever overwritten — every
 * event you save is kept for history, so you can flip back to a past event any time. */
export async function listEventConfigs(): Promise<EventConfig[]> {
  const hash = (await redis.hgetall<Record<string, EventConfig>>(CONFIGS_KEY)) ?? {};
  return Object.values(hash).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getEventConfigByName(name: string): Promise<EventConfig | null> {
  return (await redis.hget<EventConfig>(CONFIGS_KEY, name)) ?? null;
}

/** Upsert a named config. Same name = update in place (keeps history of that name); a new
 * name = a brand new entry, leaving all previous events untouched. */
export async function saveEventConfig(
  name: string,
  patch: { bulletinUrl?: string; serviceDurationsCsv?: string; serviceAfterStagesCsv?: string }
): Promise<EventConfig> {
  const now = Date.now();
  const existing = await getEventConfigByName(name);
  const cfg: EventConfig = {
    name,
    bulletinUrl: patch.bulletinUrl ?? existing?.bulletinUrl ?? "",
    serviceDurationsCsv: patch.serviceDurationsCsv ?? existing?.serviceDurationsCsv ?? "",
    serviceAfterStagesCsv: patch.serviceAfterStagesCsv ?? existing?.serviceAfterStagesCsv ?? "",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  // Store the object directly — Upstash auto-serializes/deserializes JSON values, so
  // passing a stringified value here would get double-encoded and break on read.
  await redis.hset(CONFIGS_KEY, { [name]: cfg });
  return cfg;
}

export async function setActiveEventConfig(name: string): Promise<void> {
  await redis.set(ACTIVE_KEY, name);
}

export async function getActiveEventConfig(): Promise<EventConfig | null> {
  const activeName = await redis.get<string>(ACTIVE_KEY);
  if (activeName) {
    const cfg = await getEventConfigByName(activeName);
    if (cfg) return cfg;
  }
  // No active set yet — default to the most recently updated one.
  const all = await listEventConfigs();
  return all[0] ?? null;
}

export async function getBulletinUrl(): Promise<string> {
  const active = await getActiveEventConfig();
  return active?.bulletinUrl || process.env.SPORTITY_BULLETIN_URL || SPORTITY_URL;
}

export async function getActiveServiceDurationsCsv(): Promise<string | undefined> {
  return (await getActiveEventConfig())?.serviceDurationsCsv;
}

/** Parsed list of stage numbers after which a service occurs, from the active config.
 * Returns null when unset so callers can fall back to the old always-on behavior. */
export async function getActiveServiceAfterStages(): Promise<number[] | null> {
  const csv =
    (await getActiveEventConfig())?.serviceAfterStagesCsv || process.env.SERVICE_AFTER_STAGES_CSV;
  if (!csv) return null;
  const parts = csv.split(",").map((s) => Number(s.trim()));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return parts;
}

export interface SportityDoc {
  url: string;
  title: string;
  date?: string;
}

/** Fetches the Sportity bulletin page (plain server-rendered HTML, no auth) and parses
 * out every linked PDF document with its title and published date. */
export async function scanSportityBulletin(): Promise<SportityDoc[]> {
  const res = await fetch(await getBulletinUrl(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Sportity fetch failed: ${res.status}`);
  const html = await res.text();

  const docs: SportityDoc[] = [];
  const blockRe = /<a[^>]*href="([^"]+\.pdf)"[^>]*target="_blank">([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const url = m[1];
    const inner = m[2];
    const titleM = inner.match(/&nbsp;&nbsp;([\s\S]*?)<\/h3>/i);
    const title = titleM
      ? titleM[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim()
      : "Untitled document";
    const dateM = inner.match(/<small[^>]*>([^<]+)<\/small>/i);
    docs.push({ url, title, date: dateM ? dateM[1].trim() : undefined });
  }
  return docs;
}

/** Compares the current bulletin against what we've already recorded and returns the
 * documents that are new since last run. The first run just seeds the list silently
 * (no alert) so we don't spam a big "everything is new" message. */
export async function checkSportityBulletin(): Promise<{ newDocs: SportityDoc[]; total: number }> {
  const docs = await scanSportityBulletin();
  const wasEmpty = (await redis.scard(SEEN_KEY)) === 0;
  const seen = new Set<string>((await redis.smembers(SEEN_KEY)) as string[]);
  const fresh = docs.filter((d) => !seen.has(d.url));
  for (const d of docs) await redis.sadd(SEEN_KEY, d.url);
  if (wasEmpty) return { newDocs: [], total: docs.length };
  return { newDocs: fresh, total: docs.length };
}

/** Scan once and, if anything new appeared, ping the owner on Telegram. */
export async function scanAndNotifySportity(): Promise<{ newDocs: SportityDoc[]; total: number }> {
  const { newDocs, total } = await checkSportityBulletin();
  if (newDocs.length) {
    const lines = newDocs.map((d) => `• ${d.title}${d.date ? ` — ${d.date}` : ""}\n  ${d.url}`);
    await sendOwnerTelegram(`📋 Bulletin update:\n\n${lines.join("\n")}`);
  }
  return { newDocs, total };
}

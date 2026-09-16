import { Redis } from "@upstash/redis";
import { sendOwnerTelegram } from "@/lib/telegram";

const redis = Redis.fromEnv();

// The event bulletin page — organizers post bulletins, steward decisions, schedule
// changes and other live updates here. Overridable per event via env var.
const SPORTITY_URL =
  process.env.SPORTITY_BULLETIN_URL ||
  "https://webapp.sportity.com/event/OVRMTN2026/1f16be91-de1f-43e4-adf3-f8c848ebec7f";

const SEEN_KEY = "sportity:seen";
const CONFIG_KEY = "event-config";

export interface EventConfig {
  /** Sportity bulletin page URL for the current event. */
  bulletinUrl?: string;
  /** Comma-separated service durations, e.g. "60,60,30" = service 1: 60min, 2: 60min, 3: 30min. */
  serviceDurationsCsv?: string;
}

export async function getEventConfig(): Promise<EventConfig> {
  return (await redis.get<EventConfig>(CONFIG_KEY)) ?? {};
}

export async function setEventConfig(patch: Partial<EventConfig>): Promise<EventConfig> {
  const cur = await getEventConfig();
  const next = { ...cur, ...patch };
  await redis.set(CONFIG_KEY, next);
  return next;
}

export async function getBulletinUrl(): Promise<string> {
  const cfg = await getEventConfig();
  return cfg.bulletinUrl || process.env.SPORTITY_BULLETIN_URL || SPORTITY_URL;
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

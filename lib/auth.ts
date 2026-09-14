import { createHmac, randomBytes, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { ensureUserSchema, getPool } from "@/lib/db";
import { mergeCloud } from "@/lib/cloud";

export const SESSION_COOKIE = "paranoia_sid";
const SESSION_MS = 1000 * 60 * 60 * 24 * 30;

export function sessionCookieOptions(maxAgeSec = SESSION_MS / 1000) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

export type PublicUser = {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  canGamble: boolean;
  role: string;
  pokerWins: number;
  pokerLosses: number;
  styleUnlocked: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  cloud: unknown;
  country: string | null;
  birthYear: number | null;
  photoUrl: string | null;
  ewrcId: number | null;
  ewrcKind: string | null;
  ewrcClaimStatus: string | null;
  bio: string | null;
};

type UserRow = {
  id: string;
  username_normalized: string;
  username_display: string;
  password_hash: string;
  email: string | null;
  phone: string | null;
  can_gamble: boolean;
  role: string;
  created_at: string | number;
  last_login_at: string | number | null;
  poker_wins: number;
  poker_losses: number;
  style_unlocked: boolean;
  cloud: unknown;
  country: string | null;
  birth_year: number | null;
  photo_url: string | null;
  ewrc_id: number | null;
  ewrc_kind: string | null;
  ewrc_claim_status: string | null;
  bio: string | null;
};

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username_display,
    email: row.email,
    phone: row.phone,
    canGamble: row.can_gamble,
    role: row.role,
    pokerWins: row.poker_wins,
    pokerLosses: row.poker_losses,
    styleUnlocked: row.style_unlocked,
    createdAt: Number(row.created_at),
    lastLoginAt: row.last_login_at == null ? null : Number(row.last_login_at),
    cloud: row.cloud,
    country: row.country ?? null,
    birthYear: row.birth_year == null ? null : Number(row.birth_year),
    photoUrl: row.photo_url ?? null,
    ewrcId: row.ewrc_id == null ? null : Number(row.ewrc_id),
    ewrcKind: row.ewrc_kind ?? null,
    ewrcClaimStatus: row.ewrc_claim_status ?? null,
    bio: row.bio ?? null,
  };
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validUsername(raw: string): boolean {
  return /^[a-zA-Z0-9_]{3,24}$/.test(raw.trim());
}

export function validEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.trim().replace(/[^\d+]/g, "");
  const just = digits.replace(/\+/g, "");
  if (just.length < 8 || just.length > 15) return null;
  if (digits.startsWith("+")) return `+${just}`;
  if (just.length === 10) return `+1${just}`;
  return `+${just}`;
}

export async function createUser(opts: {
  username: string;
  password: string;
  email?: string | null;
  phone?: string | null;
}): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string }> {
  await ensureUserSchema();
  const display = opts.username.trim();
  if (!validUsername(display)) return { ok: false, error: "Username must be 3–24 letters, numbers, or underscores." };
  const email = opts.email?.trim() ? opts.email.trim() : null;
  const phone = opts.phone?.trim() ? normalizePhone(opts.phone) : null;
  if (opts.phone?.trim() && !phone) return { ok: false, error: "That phone number does not look right." };
  if (email && !validEmail(email)) return { ok: false, error: "That email does not look right." };
  if (!email && !phone) return { ok: false, error: "Enter an email or a phone number." };
  if (opts.password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  const db = getPool();
  const existing = await db.query("SELECT id FROM users WHERE username_normalized = $1", [normalizeUsername(display)]);
  if (existing.rowCount) return { ok: false, error: "That username is already registered." };

  const id = randomUUID();
  const now = Date.now();
  const hash = await bcrypt.hash(opts.password, 12);
  const ownerName = (process.env.OWNER_USERNAME || "").trim().toLowerCase();
  const role = ownerName && normalizeUsername(display) === ownerName ? "owner" : "user";
  const res = await db.query(
    `INSERT INTO users (
      id, username_normalized, username_display, password_hash, email, phone,
      contact_preference, can_gamble, role, created_at, poker_wins, poker_losses, style_unlocked
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,0,0,false)
    RETURNING *`,
    [id, normalizeUsername(display), display, hash, email, phone, email ? "email" : "phone", role, now]
  );
  return { ok: true, user: toPublic(res.rows[0] as UserRow) };
}

export async function loginUser(
  username: string,
  password: string
): Promise<{ ok: true; user: PublicUser; token: string } | { ok: false }> {
  await ensureUserSchema();
  const db = getPool();
  const res = await db.query("SELECT * FROM users WHERE username_normalized = $1", [normalizeUsername(username)]);
  const row = res.rows[0] as UserRow | undefined;
  if (!row) return { ok: false };
  if ((row as { banned?: boolean }).banned) return { ok: false };
  const match = await bcrypt.compare(password, row.password_hash);
  if (!match) return { ok: false };
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  await db.query("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4)", [
    token,
    row.id,
    now,
    now + SESSION_MS,
  ]);
  await db.query("UPDATE users SET last_login_at = $1 WHERE id = $2", [now, row.id]);
  return { ok: true, user: { ...toPublic(row), lastLoginAt: now }, token };
}

export async function userFromToken(token: string | undefined | null): Promise<PublicUser | null> {
  if (!token) return null;
  await ensureUserSchema();
  const db = getPool();
  const res = await db.query(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > $2`,
    [token, Date.now()]
  );
  if (!res.rowCount) return null;
  const row = res.rows[0] as UserRow & { banned?: boolean };
  if (row.banned) return null;
  return toPublic(row);
}

export async function getSessionUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  return userFromToken(jar.get(SESSION_COOKIE)?.value);
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  await ensureUserSchema();
  await getPool().query("DELETE FROM sessions WHERE token = $1", [token]);
}

export async function saveCloud(userId: string, incoming: unknown) {
  await ensureUserSchema();
  const db = getPool();
  const res = await db.query("SELECT cloud FROM users WHERE id = $1", [userId]);
  const merged = mergeCloud(res.rows[0]?.cloud, incoming);
  await db.query("UPDATE users SET cloud = $1::jsonb WHERE id = $2", [JSON.stringify(merged), userId]);
  return merged;
}

export async function savePublicProfile(
  userId: string,
  opts: { country: string | null; birthYear: number | null; bio?: string | null }
) {
  await ensureUserSchema();
  if (opts.bio !== undefined) {
    await getPool().query(`UPDATE users SET country = $2, birth_year = $3, bio = $4 WHERE id = $1`, [
      userId,
      opts.country,
      opts.birthYear,
      opts.bio,
    ]);
  } else {
    await getPool().query(`UPDATE users SET country = $2, birth_year = $3 WHERE id = $1`, [
      userId,
      opts.country,
      opts.birthYear,
    ]);
  }
}

export async function saveUserPhoto(userId: string, username: string, bytes: Buffer, mime: string) {
  await ensureUserSchema();
  const url = `/api/users/${encodeURIComponent(username)}/photo?v=${Date.now()}`;
  await getPool().query(`UPDATE users SET photo_bytes = $2, photo_mime = $3, photo_url = $4 WHERE id = $1`, [
    userId,
    bytes,
    mime,
    url,
  ]);
  return url;
}

export async function clearUserPhoto(userId: string): Promise<string | null> {
  await ensureUserSchema();
  const db = getPool();
  const res = await db.query(
    `SELECT ewrc_id, ewrc_kind, ewrc_claim_status FROM users WHERE id = $1`,
    [userId]
  );
  const row = res.rows[0] as
    | { ewrc_id: number | null; ewrc_kind: string | null; ewrc_claim_status: string | null }
    | undefined;
  let fallback: string | null = null;
  if (row?.ewrc_claim_status === "approved" && row.ewrc_id) {
    const { getEwrcProfile } = await import("@/lib/ewrc");
    const profile = await getEwrcProfile(row.ewrc_kind === "codriver" ? "codriver" : "driver", Number(row.ewrc_id));
    fallback = profile?.photoUrl ?? null;
  }
  await db.query(`UPDATE users SET photo_bytes = NULL, photo_mime = NULL, photo_url = $2 WHERE id = $1`, [
    userId,
    fallback,
  ]);
  return fallback;
}

export async function addChangeRequest(opts: {
  user: PublicUser;
  type: "username" | "password" | "contact" | "delete" | "ewrc-claim";
  ip: string;
  payload?: string;
}) {
  await ensureUserSchema();
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO change_requests (id, user_id, username, email, phone, type, created_at, ip, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, opts.user.id, opts.user.username, opts.user.email, opts.user.phone, opts.type, Date.now(), opts.ip, opts.payload ?? null]
  );
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (token && chat) {
    const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://rallysafe-paranoia.vercel.app";
    const sig = signClaim(id);
    const text = [
      "[Paranoia] CHANGE REQUEST",
      `Type: ${opts.type}`,
      `User: ${opts.user.username} (${opts.user.id})`,
      opts.payload ? `Payload: ${opts.payload}` : "",
      `Email: ${opts.user.email || "—"}`,
      `Phone: ${opts.user.phone || "—"}`,
      `When: ${new Date().toISOString()}`,
      `IP: ${opts.ip}`,
      opts.type === "ewrc-claim"
        ? `Approve: ${origin}/api/admin/ewrc-claim?id=${id}&ok=1&sig=${sig}\nDeny: ${origin}/api/admin/ewrc-claim?id=${id}&ok=0&sig=${sig}`
        : "They expect you to reach out manually.",
    ]
      .filter(Boolean)
      .join("\n");
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text }),
    });
  }
  return id;
}

function signClaim(id: string) {
  // No hardcoded fallback secret — a missing env var must not make signatures
  // forgeable with a well-known constant.
  const secret = process.env.CLAIM_SECRET || process.env.CRON_SECRET || process.env.TELEGRAM_BOT_TOKEN || "";
  return createHmac("sha256", secret).update(id).digest("hex").slice(0, 24);
}

export function verifyClaimSig(id: string, sig: string) {
  return signClaim(id) === sig;
}

export async function recordPokerResult(userId: string, result: "win" | "loss") {
  await ensureUserSchema();
  const db = getPool();
  if (result === "win") {
    const res = await db.query(
      `UPDATE users
       SET poker_wins = poker_wins + 1, style_unlocked = true
       WHERE id = $1
       RETURNING poker_wins, poker_losses, style_unlocked`,
      [userId]
    );
    const row = res.rows[0] as { poker_wins: number; poker_losses: number; style_unlocked: boolean };
    return {
      pokerWins: row.poker_wins,
      pokerLosses: row.poker_losses,
      styleUnlocked: true,
      firstWin: row.poker_wins === 1,
    };
  }
  const res = await db.query(
    `UPDATE users SET poker_losses = poker_losses + 1 WHERE id = $1 RETURNING poker_wins, poker_losses, style_unlocked`,
    [userId]
  );
  const row = res.rows[0] as { poker_wins: number; poker_losses: number; style_unlocked: boolean };
  return {
    pokerWins: row.poker_wins,
    pokerLosses: row.poker_losses,
    styleUnlocked: !!row.style_unlocked,
    firstWin: false,
  };
}

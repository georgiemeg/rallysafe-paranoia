import { NextResponse } from "next/server";
import { ensureUserSchema, getPool } from "@/lib/db";
import { computeProfileStats } from "@/lib/cloud";
import { getEwrcProfile } from "@/lib/ewrc";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const name = decodeURIComponent(username).trim();
  if (!name) return NextResponse.json({ error: "Missing username" }, { status: 400 });
  await ensureUserSchema();
  const res = await getPool().query(
    `SELECT username_display, created_at, last_login_at, poker_wins, poker_losses, can_gamble, cloud, country, birth_year, photo_url, ewrc_id, ewrc_kind, ewrc_claim_status, bio
     FROM users WHERE username_normalized = $1`,
    [name.toLowerCase()]
  );
  const row = res.rows[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const stats = computeProfileStats({
    createdAt: Number(row.created_at),
    lastLoginAt: row.last_login_at == null ? null : Number(row.last_login_at),
    cloud: row.cloud,
  });
  let ewrc = null;
  if (row.ewrc_claim_status === "approved" && row.ewrc_id) {
    ewrc = await getEwrcProfile(row.ewrc_kind === "codriver" ? "codriver" : "driver", Number(row.ewrc_id));
    if (ewrc && row.photo_url) ewrc.photoUrl = row.photo_url;
    if (ewrc && row.country) {
      const { countryName, flagUrl, toCountryCode } = await import("@/lib/person");
      const code = toCountryCode(row.country) || String(row.country);
      ewrc.country = countryName(code) || String(row.country);
      const flag = flagUrl(code);
      if (flag) ewrc.flagUrl = flag;
    }
  }
  return NextResponse.json({
    username: row.username_display,
    pokerWins: row.poker_wins,
    pokerLosses: row.poker_losses,
    canGamble: row.can_gamble,
    country: row.country,
    birthYear: row.birth_year == null ? null : Number(row.birth_year),
    photoUrl: row.photo_url,
    bio: row.bio ?? null,
    stats,
    ewrc,
  });
}

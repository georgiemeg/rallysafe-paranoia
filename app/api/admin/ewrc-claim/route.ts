import { NextRequest, NextResponse } from "next/server";
import { ensureUserSchema, getPool } from "@/lib/db";
import { verifyClaimSig } from "@/lib/auth";
import { getEwrcProfile } from "@/lib/ewrc";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const ok = req.nextUrl.searchParams.get("ok") === "1";
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  if (!id || !verifyClaimSig(id, sig)) {
    return new NextResponse("Bad or expired link.", { status: 400 });
  }
  await ensureUserSchema();
  const db = getPool();
  const res = await db.query(`SELECT * FROM change_requests WHERE id = $1 AND type = 'ewrc-claim'`, [id]);
  const row = res.rows[0] as { user_id: string; payload: string | null } | undefined;
  if (!row) return new NextResponse("Request not found.", { status: 404 });
  let payload: { kind?: string; ewrcId?: number; name?: string } = {};
  try {
    payload = row.payload ? JSON.parse(row.payload) : {};
  } catch {
    payload = {};
  }
  if (ok && payload.ewrcId) {
    const kind = payload.kind === "codriver" ? "codriver" : "driver";
    const profile = await getEwrcProfile(kind, payload.ewrcId);
    const birthYear = profile?.born ? Number(String(profile.born).slice(0, 4)) : null;
    await db.query(
      `UPDATE users SET
         ewrc_id = $2,
         ewrc_kind = $3,
         ewrc_claim_status = 'approved',
         country = COALESCE($4, country),
         birth_year = COALESCE($5, birth_year),
         photo_url = COALESCE($6, photo_url)
       WHERE id = $1`,
      [
        row.user_id,
        payload.ewrcId,
        kind,
        profile?.country || null,
        Number.isFinite(birthYear) ? birthYear : null,
        profile?.photoUrl || null,
      ]
    );
    return new NextResponse("Approved. eWRC is now merged onto that Paranoia account.", { status: 200 });
  }
  await db.query(`UPDATE users SET ewrc_claim_status = 'denied' WHERE id = $1`, [row.user_id]);
  return new NextResponse("Denied.", { status: 200 });
}

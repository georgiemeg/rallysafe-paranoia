import { NextRequest, NextResponse } from "next/server";
import { addChangeRequest, clearUserPhoto, getSessionUser, recordPokerResult, saveCloud, savePublicProfile, saveUserPhoto } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { defaultPrefs, prefsFromCloud } from "@/lib/cloud";
import { getDevice, saveDevice } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const body = await req.json();

  if (body.action === "change-request") {
    const type = body.type as "username" | "password" | "contact" | "delete" | "ewrc-claim";
    if (!["username", "password", "contact", "delete", "ewrc-claim"].includes(type)) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    if (type === "ewrc-claim") {
      if (user.ewrcId && user.ewrcClaimStatus === "approved") {
        return NextResponse.json({ error: "This account already has an eWRC profile." }, { status: 400 });
      }
      const kind = body.kind === "codriver" ? "codriver" : "driver";
      const ewrcId = Number(body.ewrcId);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!Number.isFinite(ewrcId) || ewrcId <= 0 || !name) {
        return NextResponse.json({ error: "Pick someone from search first." }, { status: 400 });
      }
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      await getPool().query(`UPDATE users SET ewrc_claim_status = 'pending' WHERE id = $1`, [user.id]);
      await addChangeRequest({
        user,
        type,
        ip,
        payload: JSON.stringify({ kind, ewrcId, name }),
      });
      return NextResponse.json({
        ok: true,
        message: "Claim sent through Freddy. Nothing changes until it’s approved.",
      });
    }
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    await addChangeRequest({ user, type, ip });
    return NextResponse.json({
      ok: true,
      message: "Request sent. You’ll be contacted directly. Nothing has changed yet.",
    });
  }

  if (body.action === "cloud") {
    await saveCloud(user.id, body.cloud ?? null);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "prefs") {
    const current = prefsFromCloud(user.cloud);
    const prefs = {
      ...defaultPrefs(),
      ...current,
      ...(typeof body.smsEnabled === "boolean" ? { smsEnabled: body.smsEnabled } : {}),
      ...(typeof body.classScopeOnly === "boolean" ? { classScopeOnly: body.classScopeOnly } : {}),
    };
    await saveCloud(user.id, { prefs });
    const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
    if (deviceId) {
      const existing = await getDevice(deviceId);
      if (existing) {
        await saveDevice({ ...existing, smsEnabled: prefs.smsEnabled, updatedAt: Date.now() });
      }
    }
    return NextResponse.json({ ok: true, prefs });
  }

  if (body.action === "profile") {
    const country = typeof body.country === "string" ? body.country.trim().toUpperCase() || null : null;
    const rawYear = body.birthYear === "" || body.birthYear == null ? null : Number(body.birthYear);
    const birthYear = rawYear != null && Number.isFinite(rawYear) ? rawYear : null;
    const bioRaw = typeof body.bio === "string" ? body.bio.trim() : "";
    const bioWords = bioRaw ? bioRaw.split(/\s+/).slice(0, 250).join(" ") : "";
    await savePublicProfile(user.id, { country, birthYear, bio: bioWords });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "photo") {
    const raw = typeof body.image === "string" ? body.image : "";
    const m = raw.match(/^data:(image\/(jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!m) return NextResponse.json({ error: "Need a photo file." }, { status: 400 });
    const mime = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
    const bytes = Buffer.from(m[3].replace(/\s/g, ""), "base64");
    if (bytes.length < 32 || bytes.length > 450_000) {
      return NextResponse.json({ error: "Photo must be under about 400 KB." }, { status: 400 });
    }
    const photoUrl = await saveUserPhoto(user.id, user.username, bytes, mime);
    return NextResponse.json({ ok: true, photoUrl });
  }

  if (body.action === "photo-clear") {
    const photoUrl = await clearUserPhoto(user.id);
    return NextResponse.json({ ok: true, photoUrl });
  }

  if (body.action === "poker") {
    if (!user.canGamble) return NextResponse.json({ error: "No." }, { status: 403 });
    const result = body.result === "win" ? "win" : body.result === "loss" ? "loss" : null;
    if (!result) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const stats = await recordPokerResult(user.id, result);
    return NextResponse.json({
      ok: true,
      ...stats,
      ownerEmail: process.env.OWNER_EMAIL || "",
      username: user.username,
    });
  }

  return NextResponse.json({ error: "Bad request" }, { status: 400 });
}

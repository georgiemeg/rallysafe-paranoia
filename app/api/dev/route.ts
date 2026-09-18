import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireOwner } from "@/lib/dev-auth";
import { ensureUserSchema, getPool } from "@/lib/db";
import { normalizePhone, normalizeUsername, validEmail, validUsername } from "@/lib/auth";
import { getSimState, listIrregularities, runSimScript, setSimState, simInject, simOverall, crewForCar, entryIdForCar, fireSimTick, advancePlayback, trackSnapshot, applyIncident, skipOvernight, panicStop, simElapsed, resumePlayback } from "@/lib/sim/engine";
import { TEST_EVENT_ID, TEST_EVENT_NAME } from "@/lib/sim/ids";
import { listEventConfigs, saveEventConfig, setActiveEventConfig, getActiveEventConfig } from "@/lib/sportity";
import { isSystemPaused, setSystemPaused } from "@/lib/store";
import itinerary from "@/lib/sim/seed/itinerary.json";

export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireOwner().catch(() => null);
  if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await ensureUserSchema();
    let users: unknown[] = [];
    try {
      const res = await getPool().query(
        `SELECT id, username_display, username_normalized, email, phone, last_login_at, created_at, can_gamble, role, poker_wins, poker_losses, country, bio, contact_preference, banned FROM users ORDER BY username_display`
      );
      users = res.rows;
    } catch {
      const res = await getPool().query(
        `SELECT id, username_display, username_normalized, email, phone, last_login_at, created_at, can_gamble, role, poker_wins, poker_losses, country, bio, contact_preference FROM users ORDER BY username_display`
      );
      users = res.rows;
    }
    const sim = await getSimState();
    const overall = await simOverall();
    const irr = await listIrregularities(40).catch(() => []);
    return NextResponse.json({
      owner: owner.username,
      users,
      sim,
      overall,
      eventName: TEST_EVENT_NAME,
      irregularities: irr,
      itinerary,
      track: trackSnapshot(sim),
      configs: await listEventConfigs(),
      activeConfigName: (await getActiveEventConfig())?.name ?? null,
      paused: await isSystemPaused(),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "dev load failed", users: [], sim: { completed: 0, playing: false, speed: 1, smsLive: false, selectedCar: "1", playback: null }, overall: { standings: [], stages: [] }, irregularities: [], itinerary, track: { playing: false, dots: [] } }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  if (body.action === "script") {
    const sim = await runSimScript(String(body.name || "reset"));
    return NextResponse.json({ ok: true, sim, overall: await simOverall() });
  }
  if (body.action === "inject") {
    const car = String(body.car || (await getSimState()).selectedCar);
    const id = entryIdForCar(car);
    const { getSubscribersForCar } = await import("@/lib/store");
    const subs = await getSubscribersForCar(TEST_EVENT_ID, id);
    await simInject(String(body.inject || ""), car);
    if (!subs.length) {
      return NextResponse.json({
        ok: true,
        sim: await getSimState(),
        overall: await simOverall(),
        note: `Packet sent for #${car} but nobody is subscribed — go to the home page and select this car under "choose who to track" first, or nothing lands in your inbox.`,
      });
    }
    return NextResponse.json({
      ok: true,
      sim: await getSimState(),
      overall: await simOverall(),
      note: `Fake packet fired for #${car} — check inbox.`,
    });
  }
  if (body.action === "tick") {
    const sim = await advancePlayback();
    return NextResponse.json({ ok: true, sim, overall: await simOverall() });
  }
  if (body.action === "incident") {
    await applyIncident(String(body.kind || ""), String(body.car || ""));
    return NextResponse.json({ ok: true, sim: await getSimState(), overall: await simOverall() });
  }
  if (body.action === "skipOvernight") {
    const sim = await skipOvernight();
    return NextResponse.json({ ok: true, sim, overall: await simOverall() });
  }
  if (body.action === "panic") {
    const sim = await panicStop();
    return NextResponse.json({ ok: true, sim, overall: await simOverall() });
  }
  if (body.action === "resume") {
    const sim = await resumePlayback();
    return NextResponse.json({ ok: true, sim, overall: await simOverall() });
  }
  if (body.action === "cursor") {
    const st = await getSimState();
    const speed = Number(body.speed ?? st.speed ?? 1);
    const elapsed = simElapsed(st);
    const playback = st.playback
      ? {
          ...st.playback,
          t0: Date.now() - elapsed / Math.max(0.25, speed),
          elapsedMs: elapsed,
          lastTickAt: Date.now(),
          frozenElapsed: st.playing ? undefined : elapsed,
        }
      : null;
    const sim = await setSimState({
      speed,
      smsLive: body.smsLive !== undefined ? Boolean(body.smsLive) : st.smsLive,
      selectedCar: body.selectedCar ? String(body.selectedCar) : st.selectedCar,
      selectedCars: Array.isArray(body.selectedCars) ? body.selectedCars.map(String) : st.selectedCars,
      playback,
    });
    return NextResponse.json({ ok: true, sim, overall: await simOverall() });
  }
  if (body.action === "gamble") {
    const ids: string[] = Array.isArray(body.userIds) ? body.userIds.map(String) : [];
    await ensureUserSchema();
    await getPool().query(`UPDATE users SET can_gamble = FALSE`);
    if (ids.length) {
      await getPool().query(`UPDATE users SET can_gamble = TRUE WHERE id = ANY($1::text[])`, [ids]);
    }
    return NextResponse.json({ ok: true });
  }
  if (body.action === "admin") {
    const id = String(body.userId || "");
    if (!id) return NextResponse.json({ error: "Missing user" }, { status: 400 });
    const row = await getPool().query(`SELECT username_normalized, role FROM users WHERE id = $1`, [id]);
    if (!row.rowCount) return NextResponse.json({ error: "Missing user" }, { status: 404 });
    const { isHardAdmin } = await import("@/lib/dev-auth");
    if (isHardAdmin(row.rows[0].username_normalized)) {
      return NextResponse.json({ error: "That account is always admin" }, { status: 400 });
    }
    const on = Boolean(body.admin);
    await getPool().query(`UPDATE users SET role = $1 WHERE id = $2`, [on ? "admin" : "user", id]);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "user") {
    const id = String(body.userId || "");
    if (!id) return NextResponse.json({ error: "Missing user" }, { status: 400 });
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (typeof body.username === "string" && body.username.trim()) {
      if (!validUsername(body.username)) return NextResponse.json({ error: "Bad username" }, { status: 400 });
      const n = normalizeUsername(body.username);
      const clash = await getPool().query(`SELECT id FROM users WHERE username_normalized = $1 AND id <> $2`, [n, id]);
      if (clash.rowCount) return NextResponse.json({ error: "Username taken" }, { status: 400 });
      sets.push(`username_display = $${i++}`, `username_normalized = $${i++}`);
      vals.push(body.username.trim(), n);
    }
    if (body.email !== undefined) {
      const email = String(body.email || "").trim();
      if (email && !validEmail(email)) return NextResponse.json({ error: "Bad email" }, { status: 400 });
      sets.push(`email = $${i++}`);
      vals.push(email || null);
    }
    if (body.phone !== undefined) {
      const raw = String(body.phone || "").trim();
      const phone = raw ? normalizePhone(raw) : null;
      if (raw && !phone) return NextResponse.json({ error: "Bad phone" }, { status: 400 });
      sets.push(`phone = $${i++}`);
      vals.push(phone);
    }
    if (typeof body.password === "string" && body.password.length) {
      if (body.password.length < 8) return NextResponse.json({ error: "Password must be 8+ characters" }, { status: 400 });
      sets.push(`password_hash = $${i++}`);
      vals.push(await bcrypt.hash(body.password, 12));
    }
    if (!sets.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    vals.push(id);
    await getPool().query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${i}`, vals);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "ban" || body.action === "unban") {
    const id = String(body.userId || "");
    if (!id) return NextResponse.json({ error: "Missing user" }, { status: 400 });
    const row = await getPool().query(`SELECT username_normalized FROM users WHERE id = $1`, [id]);
    if (!row.rowCount) return NextResponse.json({ error: "Missing user" }, { status: 404 });
    const { isHardAdmin } = await import("@/lib/dev-auth");
    if (isHardAdmin(row.rows[0].username_normalized)) {
      return NextResponse.json({ error: "Can't ban that account" }, { status: 400 });
    }
    const banned = body.action === "ban";
    await getPool().query(`UPDATE users SET banned = $1 WHERE id = $2`, [banned, id]);
    if (banned) await getPool().query(`DELETE FROM sessions WHERE user_id = $1`, [id]);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "remove") {
    const id = String(body.userId || "");
    if (!id) return NextResponse.json({ error: "Missing user" }, { status: 400 });
    const row = await getPool().query(`SELECT username_normalized FROM users WHERE id = $1`, [id]);
    if (!row.rowCount) return NextResponse.json({ error: "Missing user" }, { status: 404 });
    const { isHardAdmin } = await import("@/lib/dev-auth");
    if (isHardAdmin(row.rows[0].username_normalized) || id === owner.id) {
      return NextResponse.json({ error: "Can't remove that account" }, { status: 400 });
    }
    await getPool().query(`DELETE FROM sessions WHERE user_id = $1`, [id]);
    await getPool().query(`DELETE FROM change_requests WHERE user_id = $1`, [id]);
    await getPool().query(`DELETE FROM users WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "event-config") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Name the config (e.g. 'Overmountain 2026')." }, { status: 400 });
    const patch: { bulletinUrl?: string; serviceDurationsCsv?: string; serviceAfterStagesCsv?: string } = {};
    if (typeof body.bulletinUrl === "string") patch.bulletinUrl = body.bulletinUrl.trim();
    if (typeof body.serviceDurationsCsv === "string") patch.serviceDurationsCsv = body.serviceDurationsCsv.trim();
    if (typeof body.serviceAfterStagesCsv === "string") patch.serviceAfterStagesCsv = body.serviceAfterStagesCsv.trim();
    const config = await saveEventConfig(name, patch);
    if (body.active !== false) await setActiveEventConfig(name);
    return NextResponse.json({ ok: true, config });
  }
  if (body.action === "event-config-activate") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Missing config name." }, { status: 400 });
    await setActiveEventConfig(name);
    return NextResponse.json({ ok: true, active: name });
  }
  if (body.action === "setPaused") {
    const paused = Boolean(body.paused);
    await setSystemPaused(paused);
    return NextResponse.json({
      ok: true,
      paused,
      note: paused
        ? "Background CPU paused — poller, simulator tick, and Sportity scanner are now idle."
        : "Background CPU resumed — polling is active again.",
    });
  }
  return NextResponse.json({ error: "Bad request" }, { status: 400 });
}

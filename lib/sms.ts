import twilio from "twilio";
import { Redis } from "@upstash/redis";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;
const MAX_PER_HOUR = 20;

let client: ReturnType<typeof twilio> | null = null;
const redis = Redis.fromEnv();

function getClient() {
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)");
  }
  if (!client) client = twilio(accountSid, authToken);
  return client;
}

/** Hard global kill switch. When SMS_DISABLED is set to "1" (or any truthy value) in the
 * environment, NO outbound Twilio message is ever attempted, from anywhere in the app —
 * this check runs before rate limiting, before the Twilio client is even constructed, so
 * it can't be bypassed by any other code path. Set/unset via Vercel env vars. */
function smsHardStopped(): boolean {
  return process.env.SMS_DISABLED === "1" || process.env.SMS_DISABLED === "true";
}

// Twilio charges per SMS segment (~153 GSM-7 chars each) even when the message is never
// delivered (e.g. unverified toll-free number, bad number, carrier filtering). A single
// batched alert (multiple alert types joined with ==== dividers) can silently balloon to
// 15-18+ segments — real money burned on a message that was never going to arrive. Cap
// hard at 3 segments (~459 chars); anything longer gets truncated with a note instead of
// being sent whole. This is a safety net, not a formatting fix — batchMessages() should
// still be kept reasonably short on its own.
const MAX_SEGMENTS = 3;
const CHARS_PER_SEGMENT = 153;
const MAX_BODY_CHARS = MAX_SEGMENTS * CHARS_PER_SEGMENT;

function capMessageLength(body: string): string {
  if (body.length <= MAX_BODY_CHARS) return body;
  const suffix = "\n[…truncated — check the app inbox for the full alert]";
  const keep = MAX_BODY_CHARS - suffix.length;
  return body.slice(0, Math.max(0, keep)) + suffix;
}

export async function sendSms(to: string, body: string) {
  if (smsHardStopped()) {
    console.warn("SMS hard-stopped (SMS_DISABLED env var set) — not sending", { to });
    throw new Error("SMS sending is currently disabled (SMS_DISABLED).");
  }
  if (!fromNumber) {
    throw new Error("TWILIO_FROM_NUMBER not configured");
  }
  const rateKey = `sms:hour:${to}`;
  const n = await redis.incr(rateKey);
  if (n === 1) await redis.expire(rateKey, 3600);
  if (n > MAX_PER_HOUR) {
    throw new Error(`Rate limited: ${MAX_PER_HOUR} SMS/hour for ${to}`);
  }
  const safeBody = capMessageLength(body);
  if (safeBody.length !== body.length) {
    console.warn("SMS body capped before send", { to, originalLength: body.length, cappedLength: safeBody.length });
  }
  const c = getClient();
  const msg = await c.messages.create({ to, from: fromNumber, body: safeBody });
  console.info("SMS queued", { to, sid: msg.sid, status: msg.status });
  return msg;
}

import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { findDeviceByPhone, deviceIdsForPhone, getDevice, saveDevice } from "@/lib/store";
import { runCommand } from "@/lib/commands";
import { HELP_MESSAGE } from "@/lib/messages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function parseTwilioBody(req: NextRequest): Promise<{ from: string; body: string; params: Record<string, string> }> {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => { params[key] = String(value); });
  return {
    from: String(form.get("From") ?? ""),
    body: String(form.get("Body") ?? ""),
    params,
  };
}

// Verify the request was actually signed by Twilio so a third party can't forge
// an SMS (e.g. spoofing STOP from someone's number, or injecting commands).
function twilioSignatureValid(req: NextRequest, params: Record<string, string>): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!authToken || !signature) return false;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const url = `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
  try {
    return twilio.validateRequest(authToken, signature, url, params);
  } catch {
    return false;
  }
}

function twiml(message?: string): NextResponse {
  const xml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new NextResponse(xml, { headers: { "Content-Type": "text/xml" } });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Carrier-mandated keywords (Twilio requires these work regardless of app registration state).
// Matched case-insensitively against the WHOLE trimmed message, same as every major SMS platform.
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "yes", "unstop"]);
const HELP_WORDS = new Set(["help", "info"]);

export async function POST(req: NextRequest) {
  const { from, body, params } = await parseTwilioBody(req);
  if (!twilioSignatureValid(req, params)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }
  const normalized = body.trim().toLowerCase();

  // STOP/START/HELP must work for ANY number that has ever texted in, even if it isn't
  // registered with a device yet, and must apply to every device sharing that phone number
  // (a phone can be saved against multiple deviceIds — see deviceIdsForPhone).
  if (STOP_WORDS.has(normalized)) {
    const ids = await deviceIdsForPhone(from);
    for (const id of ids) {
      const d = await getDevice(id);
      if (d) await saveDevice({ ...d, smsEnabled: false, updatedAt: Date.now() });
    }
    return twiml(
      "You're unsubscribed from RallySafe Paranoia texts and won't receive any more. Reply START to opt back in."
    );
  }

  if (START_WORDS.has(normalized)) {
    const ids = await deviceIdsForPhone(from);
    if (ids.length === 0) {
      return twiml(
        "This number isn't registered with RallySafe Paranoia yet. Set up tracking and opt in at the web app first."
      );
    }
    for (const id of ids) {
      const d = await getDevice(id);
      if (d) await saveDevice({ ...d, smsEnabled: true, updatedAt: Date.now() });
    }
    return twiml("You're re-subscribed to RallySafe Paranoia texts. Reply HELP for commands, STOP to opt out again.");
  }

  if (HELP_WORDS.has(normalized)) {
    return twiml(HELP_MESSAGE);
  }

  const device = await findDeviceByPhone(from);
  if (!device) {
    return twiml(
      "This number isn't registered with RallySafe Paranoia. Set up tracking at the web app first."
    );
  }
  if (device.smsEnabled === false) {
    return twiml("You're currently unsubscribed. Reply START to opt back in.");
  }
  const reply = await runCommand(device.deviceId, body);
  return twiml(reply);
}

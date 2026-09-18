import { NextRequest, NextResponse } from "next/server";
import { getDevice, saveDevice, getPhoneConsent, recordPhoneConsent } from "@/lib/store";
import { deliverAlert } from "@/lib/deliver";

export const dynamic = "force-dynamic";

function normalizePhone(raw: string): string | null {
  const digits = raw.trim().replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && digits.length >= 8) return digits;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  const phoneRaw = typeof body.phone === "string" ? body.phone : "";
  const eventId = typeof body.eventId === "number" ? body.eventId : 0;
  const smsConsent = body.smsConsent === true;

  if (!deviceId) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }
  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    return NextResponse.json({ error: "Enter a valid phone number first." }, { status: 400 });
  }

  // Same consent gate as the Save & Start Tracking flow: a test text is still an outbound
  // SMS to a real number, so Twilio requires opt-in before it can be sent.
  const phoneConsent = await getPhoneConsent(phone);
  if (!phoneConsent && !smsConsent) {
    return NextResponse.json({ error: "SMS consent is required before texts can be sent.", needsConsent: true }, { status: 400 });
  }
  const consentIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (smsConsent && !phoneConsent) {
    await recordPhoneConsent(phone, consentIp);
  }

  const now = Date.now();
  const existing = await getDevice(deviceId);
  await saveDevice({
    deviceId,
    phone,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  const text =
    "Megennis Motorsport, LLC (RallySafe Paranoia) test. If you got this, texts are working. Reply STOP to unsubscribe. " +
    "Save this number in your contacts so real alerts don't get filtered.";

  const result = await deliverAlert({
    deviceId,
    phone,
    eventId,
    alertType: "test",
    body: text,
  });

  return NextResponse.json({
    ok: true,
    ...result,
    phone,
  });
}

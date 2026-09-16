import { NextRequest, NextResponse } from "next/server";
import {
  saveDevice,
  saveSubscriptionsForEvent,
  getDevice,
  getDeviceSubscriptionsForEvent,
  getPhoneConsent,
  recordPhoneConsent,
  ALERT_TYPES,
  type AlertType,
  type CarSubscription,
} from "@/lib/store";
import { deliverAlert } from "@/lib/deliver";

export const dynamic = "force-dynamic";

function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && digits.length >= 8) return digits;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

interface CarInput {
  entryId: number;
  carNumber: string;
  driverName: string;
  codriverName: string;
  carClass: string;
  carModelYear: string;
  alerts: Partial<Record<AlertType, boolean>>;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { deviceId, phone, eventId, cars, smsConsent } = body as {
    deviceId?: string;
    phone?: string;
    eventId?: number;
    cars?: CarInput[];
    smsConsent?: boolean;
  };

  if (!deviceId || typeof deviceId !== "string") {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }
  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return NextResponse.json({ error: "Could not parse phone number" }, { status: 400 });
  }
  if (!eventId || !Array.isArray(cars)) {
    return NextResponse.json({ error: "eventId and cars are required" }, { status: 400 });
  }

  const now = Date.now();
  const existingDevice = await getDevice(deviceId);
  const isNewPhone = existingDevice?.phone !== normalized;

  // Twilio requires explicit, logged opt-in before the first SMS is ever sent to a number.
  // Consent is tracked per PHONE NUMBER (not per device), so the same number keeps its opt-in
  // across browsers/devices, and a new number always has to opt in again.
  const phoneConsent = await getPhoneConsent(normalized);
  if (!phoneConsent && smsConsent !== true) {
    return NextResponse.json({ error: "SMS consent is required before texts can be sent.", needsConsent: true }, { status: 400 });
  }

  const forwardedFor = req.headers.get("x-forwarded-for");
  const consentIp = forwardedFor ? forwardedFor.split(",")[0].trim() : undefined;
  const grantedNow = smsConsent === true && !phoneConsent;
  if (grantedNow) {
    await recordPhoneConsent(normalized, consentIp);
  }

  await saveDevice({
    deviceId,
    phone: normalized,
    createdAt: existingDevice?.createdAt ?? now,
    updatedAt: now,
    smsEnabled: existingDevice?.smsEnabled ?? true,
    smsConsentAt: grantedNow ? now : existingDevice?.smsConsentAt,
    smsConsentIp: grantedNow ? consentIp : existingDevice?.smsConsentIp,
  });

  const fullAlerts = (partial: Partial<Record<AlertType, boolean>>): Record<AlertType, boolean> => {
    const out = {} as Record<AlertType, boolean>;
    for (const t of ALERT_TYPES) out[t] = partial[t] ?? false;
    return out;
  };

  const carSubs: Omit<CarSubscription, "deviceId" | "eventId" | "createdAt" | "updatedAt">[] = cars.map(
    (c) => ({
      entryId: c.entryId,
      carNumber: c.carNumber,
      driverName: c.driverName,
      codriverName: c.codriverName,
      carClass: c.carClass,
      carModelYear: c.carModelYear,
      alerts: fullAlerts(c.alerts),
      classScopeOnly: false,
    })
  );

  await saveSubscriptionsForEvent(deviceId, eventId, carSubs);
  if (carSubs.length === 0) {
    const { deviceIdsForPhone } = await import("@/lib/store");
    const others = await deviceIdsForPhone(normalized);
    for (const id of others) {
      if (id !== deviceId) await saveSubscriptionsForEvent(id, eventId, []);
    }
  }

  // Confirmation text: prompts the user to save the alert number as a contact so future
  // texts don't land as "unknown sender", and doubles as proof the number/setup works.
  let confirmationSmsSent = false;
  let confirmationSmsError: string | null = null;
  try {
    const carList = carSubs.length > 0
      ? carSubs.map((c) => `#${c.carNumber} ${c.driverName}`).join(", ")
      : "no cars yet";
    const savePrompt =
      `RallySafe Paranoia: You're enrolled! Now tracking: ${carList}.\n\n` +
      `Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel. ` +
      `Save this number to your contacts so alerts don't get missed.`;
    const delivered = await deliverAlert({
      deviceId,
      phone: normalized,
      eventId,
      alertType: "setup",
      body: savePrompt,
    });
    confirmationSmsSent = delivered.sms;
  } catch (err) {
    confirmationSmsError = err instanceof Error ? err.message : "Unknown SMS error";
    console.error("Confirmation SMS failed:", err);
  }

  return NextResponse.json({
    ok: true,
    phone: normalized,
    savedCount: carSubs.length,
    confirmationSmsSent,
    confirmationSmsError,
    isNewPhone,
  });
}

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("deviceId");
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!deviceId || !eventId) {
    return NextResponse.json({ error: "deviceId and eventId query params required" }, { status: 400 });
  }
  const [device, subs] = await Promise.all([
    getDevice(deviceId),
    getDeviceSubscriptionsForEvent(deviceId, Number(eventId)),
  ]);
  return NextResponse.json({ device, subscriptions: subs });
}

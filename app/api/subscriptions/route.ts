import { NextRequest, NextResponse } from "next/server";
import {
  saveDevice,
  saveSubscriptionsForEvent,
  getDevice,
  getDeviceSubscriptionsForEvent,
  ALERT_TYPES,
  type AlertType,
  type CarSubscription,
} from "@/lib/store";
import { sendSms } from "@/lib/sms";

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
  const { deviceId, phone, eventId, cars } = body as {
    deviceId?: string;
    phone?: string;
    eventId?: number;
    cars?: CarInput[];
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
  await saveDevice({
    deviceId,
    phone: normalized,
    createdAt: existingDevice?.createdAt ?? now,
    updatedAt: now,
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

  // Confirmation text: prompts the user to save the alert number as a contact so future
  // texts don't land as "unknown sender", and doubles as proof the number/setup works.
  let confirmationSmsSent = false;
  let confirmationSmsError: string | null = null;
  try {
    const carList = carSubs.length > 0
      ? carSubs.map((c) => `#${c.carNumber} ${c.driverName}`).join(", ")
      : "no cars yet";
    const savePrompt =
      `RallySafe Paranoia is set up! Now tracking: ${carList}.\n\n` +
      `Save this number to your contacts so alerts don't get missed — text HELP anytime for commands.`;
    await sendSms(normalized, savePrompt);
    confirmationSmsSent = true;
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

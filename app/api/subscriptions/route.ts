import { NextRequest, NextResponse } from "next/server";
import { saveDevice, setSubscriptions, getDevice, getDeviceSubscriptions } from "@/lib/store";

export const dynamic = "force-dynamic";

// Very light E.164-ish validation. We don't need to be strict — Twilio will
// reject genuinely malformed numbers at send time anyway.
function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && digits.length >= 8) return digits;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`; // assume US 10-digit
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { deviceId, phone, eventId, entryIds } = body as {
    deviceId?: string;
    phone?: string;
    eventId?: number;
    entryIds?: number[];
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
  if (!eventId || !Array.isArray(entryIds)) {
    return NextResponse.json({ error: "eventId and entryIds are required" }, { status: 400 });
  }

  const now = Date.now();
  const existing = await getDevice(deviceId);
  await saveDevice({
    deviceId,
    phone: normalized,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  await setSubscriptions(deviceId, eventId, entryIds);

  return NextResponse.json({ ok: true, phone: normalized });
}

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("deviceId");
  if (!deviceId) {
    return NextResponse.json({ error: "deviceId query param required" }, { status: 400 });
  }
  const [device, subs] = await Promise.all([
    getDevice(deviceId),
    getDeviceSubscriptions(deviceId),
  ]);
  return NextResponse.json({ device, subscriptions: subs });
}

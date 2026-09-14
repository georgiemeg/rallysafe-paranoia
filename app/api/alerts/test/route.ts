import { NextRequest, NextResponse } from "next/server";
import { getDevice, saveDevice } from "@/lib/store";
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

  if (!deviceId) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }
  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    return NextResponse.json({ error: "Enter a valid phone number first." }, { status: 400 });
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
    "RallySafe Paranoia test. If you got this, texts are working. Save this number in your contacts so real alerts don't get filtered.";

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

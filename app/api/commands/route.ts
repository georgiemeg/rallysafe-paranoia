import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/store";
import { runCommand } from "@/lib/commands";
import { deliverAlert } from "@/lib/deliver";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  const command = typeof body.command === "string" ? body.command : "";
  if (!deviceId) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }
  if (!command.trim()) {
    return NextResponse.json({ error: "Type a command first." }, { status: 400 });
  }

  const device = await getDevice(deviceId);
  const reply = await runCommand(deviceId, command);

  await deliverAlert({
    deviceId,
    phone: null,
    eventId: 0,
    alertType: "command",
    body: `> ${command.trim()}\n\n${reply}`,
  });

  return NextResponse.json({ ok: true, reply, phone: device?.phone ?? null });
}

import { NextRequest, NextResponse } from "next/server";
import { listInbox } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("deviceId");
  if (!deviceId) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }
  const messages = await listInbox(deviceId);
  return NextResponse.json({ messages });
}

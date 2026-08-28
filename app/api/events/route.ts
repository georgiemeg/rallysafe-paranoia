import { NextResponse } from "next/server";
import { listEvents } from "@/lib/rallysafe";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const events = await listEvents({ take: 50 });
    return NextResponse.json({ events });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 502 });
  }
}

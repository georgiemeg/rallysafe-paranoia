import { NextRequest, NextResponse } from "next/server";
import { getEwrcProfile } from "@/lib/ewrc";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") === "codriver" ? "codriver" : "driver";
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  const profile = await getEwrcProfile(kind, id);
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ profile });
}

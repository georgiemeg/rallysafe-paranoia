import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  let db = false;
  try {
    await getPool().query("SELECT 1");
    db = true;
  } catch {
    db = false;
  }
  return NextResponse.json({
    ok: true,
    ms: Date.now() - t0,
    db,
    time: new Date().toISOString(),
    sha: process.env.VERCEL_GIT_COMMIT_SHA || "",
    region: process.env.VERCEL_REGION || "",
  });
}

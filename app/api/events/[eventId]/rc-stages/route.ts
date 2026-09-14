import { NextRequest, NextResponse } from "next/server";
import { listStages } from "@/lib/rallysafe";
import { getRcCarStages } from "@/lib/rallysafe-rc-overall";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Per-car stage-by-stage times for the live/fallback Results path (RallySafe's raw
// feed), mirroring /api/results/ewrc-full/stages for finished eWRC events so clicking a
// row works the same way on both paths.
export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const carNumber = req.nextUrl.searchParams.get("car");
  const id = Number(eventId);
  if (!Number.isFinite(id) || !carNumber) {
    return NextResponse.json({ error: "Missing eventId or car" }, { status: 400 });
  }
  const stages = await listStages(id);
  const data = await getRcCarStages(stages, carNumber);
  if (!data) return NextResponse.json({ error: "No stage times found for this car." }, { status: 404 });
  return NextResponse.json(data);
}

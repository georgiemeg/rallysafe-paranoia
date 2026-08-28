import { NextRequest, NextResponse } from "next/server";
import { getEntries } from "@/lib/rallysafe";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  const id = Number(eventId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
  }
  try {
    const entries = await getEntries(id);
    // Slim down the payload to just what the UI needs
    const slim = entries.map((e) => ({
      entryId: e.entryId,
      identifier: e.identifier, // car number
      classText: e.classText,
      driver: e.vehicle?.driver
        ? `${e.vehicle.driver.firstName} ${e.vehicle.driver.surname}`
        : "Unknown",
      navigator: e.vehicle?.navigator
        ? `${e.vehicle.navigator.firstName} ${e.vehicle.navigator.surname}`
        : null,
      make: e.vehicle?.make,
    }));
    return NextResponse.json({ entries: slim });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch entries" }, { status: 502 });
  }
}

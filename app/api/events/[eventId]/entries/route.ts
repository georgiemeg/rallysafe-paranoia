import { NextRequest, NextResponse } from "next/server";
import { getEntries, getResultsEventId } from "@/lib/rallysafe";
import { getEventDetails as getResultsEventDetails, getRallyEntries } from "@/lib/rallysafe-results";

export const dynamic = "force-dynamic";

interface CombinerEntry {
  number: number;
  carModel: string; // e.g. "1977 Ford Escort" (includes year, unlike results API's vehicleModel)
}

async function fetchModelYearMap(): Promise<Map<string, string>> {
  // Public, unauthenticated aggregator that happens to include year+model together.
  // Best-effort enrichment only — if it's down/changed we fall back to make-only.
  const map = new Map<string, string>();
  try {
    const res = await fetch("https://sneakattackrally.com/ARACombinerThing/data/live/event1.json", {
      cache: "no-store",
    });
    if (!res.ok) return map;
    const data = await res.json();
    const entries: CombinerEntry[] = data?.entries ?? [];
    for (const e of entries) {
      if (e.carModel) map.set(String(e.number), e.carModel);
    }
  } catch {
    // ignore — enrichment is optional
  }
  return map;
}

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
    const [entries, modelYearMap] = await Promise.all([
      getEntries(id),
      fetchModelYearMap(),
    ]);

    // Best-effort class enrichment from the Results API (separate id space, mapped by car #).
    const classByCarNumber = new Map<string, string>();
    try {
      const resultsEventId = await getResultsEventId(id);
      if (resultsEventId) {
        const details = await getResultsEventDetails(resultsEventId);
        for (const rally of details.rallies) {
          const rallyEntries = await getRallyEntries(resultsEventId, rally.rallyId);
          for (const re of rallyEntries) {
            const className = re.eventClasses?.[0]?.name;
            if (className) classByCarNumber.set(re.identifier, className);
          }
        }
      }
    } catch {
      // ignore — fall back to the live feed's own classText below
    }

    const slim = entries.map((e) => {
      const carClass = classByCarNumber.get(e.identifier) ?? e.classText ?? "";
      const modelYear = modelYearMap.get(e.identifier) ?? e.vehicle?.make ?? "";
      return {
        entryId: e.entryId,
        identifier: e.identifier,
        carClass,
        driver: e.vehicle?.driver
          ? `${e.vehicle.driver.firstName} ${e.vehicle.driver.surname}`
          : "Unknown",
        navigator: e.vehicle?.navigator
          ? `${e.vehicle.navigator.firstName} ${e.vehicle.navigator.surname}`
          : null,
        carModelYear: modelYear,
      };
    });
    return NextResponse.json({ entries: slim });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch entries" }, { status: 502 });
  }
}

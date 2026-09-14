import { NextRequest, NextResponse } from "next/server";
import { getEntries, listEvents } from "@/lib/rallysafe";
import { findCombinerEventByName } from "@/lib/combiner";
import { getEwrcFinalStandings, listEwrcEventsLastTwoWeeks } from "@/lib/ewrc-results";
import { getSessionUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/dev-auth";
import { testEventRow } from "@/lib/sim/ids";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type EventRow = {
  key: string;
  name: string;
  eventId: number;
  source: "rallysafe" | "ewrc";
  ewrcId: number | null;
  rallysafeId: number | null;
  done: boolean;
  from: string;
  until: string;
};

/** Collapse "Ojibwe Forests Rally" / "Ojibwe Forests Rally 2026" to one key.
 *  Leaves " - Regional" in place so national and regional stay distinct. */
function eventIdentity(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Once the finished eWRC listing is up, hide the RallySafe copy of that same
 *  event — even if RallySafe still serves it. National vs regional are different
 *  identities and both stay. */
function dropCoveredRallysafe(live: EventRow[], finished: EventRow[]): EventRow[] {
  const covered = new Set(finished.map((e) => eventIdentity(e.name)));
  return live.filter((e) => !covered.has(eventIdentity(e.name)));
}

export async function GET(req: NextRequest) {
  try {
    const liveOnly = req.nextUrl.searchParams.get("live") === "1";
    const rs = await listEvents({ take: 50 }).catch(() => []);
    const user = await getSessionUser().catch(() => null);
    const owner = Boolean(user && isAdminUser(user));

    const araEventIds: number[] = [];
    await Promise.all(
      rs.map(async (ev) => {
        try {
          if (await findCombinerEventByName(ev.name)) araEventIds.push(ev.eventId);
        } catch {
          // skip
        }
      })
    );
    if (owner) araEventIds.push(20251925);

    const prependTest = (list: EventRow[]) =>
      owner ? [testEventRow(), ...list.filter((e) => e.key !== testEventRow().key)] : list;

    const counts = await Promise.all(
      rs.map(async (ev) => {
        try {
          const entries = await getEntries(ev.eventId);
          return { ev, n: Array.isArray(entries) ? entries.length : 0 };
        } catch {
          return { ev, n: 0 };
        }
      })
    );

    const liveRallysafe: EventRow[] = counts
      .filter((c) => c.n > 0)
      .map(({ ev }) => ({
        key: `rs:${ev.eventId}`,
        name: ev.name,
        eventId: ev.eventId,
        source: "rallysafe" as const,
        ewrcId: null,
        rallysafeId: ev.eventId,
        done: false,
        from: ev.startDate ?? "",
        until: ev.endDate ?? "",
      }));

    const ewrc = await listEwrcEventsLastTwoWeeks().catch(() => []);
    const finished = (
      await Promise.all(
        ewrc
          .filter((e) => e.done && e.ewrcId)
          .map(async (e) => {
            try {
              const data = await getEwrcFinalStandings(e.ewrcId!);
              if (!data?.standings?.length) return null;
              const row: EventRow = {
                key: e.key,
                name: e.name,
                eventId: e.ewrcId ?? 0,
                source: "ewrc",
                ewrcId: e.ewrcId,
                rallysafeId: null,
                done: true,
                from: e.from,
                until: e.until,
              };
              return row;
            } catch {
              return null;
            }
          })
      )
    ).filter((e): e is EventRow => Boolean(e));

    const liveUncovered = dropCoveredRallysafe(liveRallysafe, finished);

    if (liveOnly) {
      const listed = prependTest(liveUncovered);
      return NextResponse.json({
        events: listed,
        activeEventId: listed[0]?.eventId ?? null,
        activeKey: listed[0]?.key ?? null,
        araEventIds,
      });
    }

    const listed = prependTest([...liveUncovered, ...finished]);
    return NextResponse.json({
      events: listed,
      activeEventId: listed[0]?.eventId ?? null,
      activeKey: listed[0]?.key ?? null,
      araEventIds,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 502 });
  }
}

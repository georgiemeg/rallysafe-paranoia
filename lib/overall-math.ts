/** Pure overall math — Sneak Attack / ARA live combiner rules. No I/O. */

export function accumulateOverall(
  stageStatuses: string[],
  timesMs: Array<number | null>
): { lastStage: number; totalMs: number; stopped: boolean } | null {
  let totalMs = 0;
  let lastStage = 0;
  let stopped = false;
  for (let y = 0; y < stageStatuses.length; y++) {
    const st = stageStatuses[y] || "";
    if (stopped) continue;
    if (/^cancelled$/i.test(st)) {
      // Cancelled stages still advance field distance — nobody runs them, so every car
      // still in the rally is credited with that itinerary slot. (This is what the
      // "16 stages" count complaint was about: cancelled stages weren't being counted.)
      lastStage = y + 1;
      continue;
    }
    if (/^waiting$/i.test(st)) continue;
    const ms = timesMs[y] ?? null;
    if (ms != null) {
      totalMs += ms;
      lastStage = y + 1;
    } else if (/^completed$/i.test(st)) {
      // Missing a time on a stage the field completed = the car is out (DNF) or has
      // stopped being scored. This is the field-distance "hole" rule.
      stopped = true;
    }
  }
  if (lastStage === 0) return null;
  return { lastStage, totalMs, stopped };
}

/** Ticket E: empty sentence only when BOTH live and official have nothing to report. */
export function emptyTimesCopyAllowed(liveHasTimes: boolean, officialHasTimes: boolean): boolean {
  return !liveHasTimes && !officialHasTimes;
}

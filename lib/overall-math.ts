/** Pure overall math — Sneak Attack / ARA live combiner rules. No I/O. */

export function accumulateOverall(
  stageStatuses: string[],
  timesMs: Array<number | null>
): { lastStage: number; totalMs: number } | null {
  let totalMs = 0;
  let lastStage = 0;
  let stopped = false;
  for (let y = 0; y < stageStatuses.length; y++) {
    const st = stageStatuses[y] || "";
    if (/^cancelled$/i.test(st) || /^waiting$/i.test(st)) continue;
    if (stopped) continue;
    const ms = timesMs[y] ?? null;
    if (ms != null) {
      totalMs += ms;
      lastStage = y + 1;
    } else if (/^completed$/i.test(st)) {
      stopped = true;
    }
  }
  if (lastStage === 0) return null;
  return { lastStage, totalMs };
}

/** Ticket E: empty sentence only when BOTH live and official have nothing to report. */
export function emptyTimesCopyAllowed(liveHasTimes: boolean, officialHasTimes: boolean): boolean {
  return !liveHasTimes && !officialHasTimes;
}

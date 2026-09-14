/** Last-name key so the grid can sit A–Z until someone actually has a time. */
function driverAlpha<T extends { driverName?: string }>(a: T, b: T) {
  const key = (r: T) => {
    const d = (r.driverName || "").trim();
    const last = d.split(/\s+/).pop() || d;
    return `${last.toLowerCase()}\0${d.toLowerCase()}`;
  };
  return key(a).localeCompare(key(b), undefined, { sensitivity: "base" });
}

/** Running order: cars that have finished the current distance, by time.
 * Cars with no stage time yet stay on the entry list A–Z with zeros.
 * DNFs sit at the bottom. */
export function rankByFieldDistance<
  T extends {
    isRetired: boolean;
    stagesCompleted: number;
    totalMs: number;
    position: number;
    gapToLeaderMs: number;
    gapToAheadMs: number;
    driverName?: string;
  },
>(rows: T[]): T[] {
  if (rows.length === 0) return rows;
  const running = rows.filter((r) => !r.isRetired);
  const distance = running.reduce((m, r) => Math.max(m, r.stagesCompleted), 0);

  if (distance === 0) {
    const waiting = running.slice().sort(driverAlpha);
    const dnf = rows.filter((r) => r.isRetired).sort(driverAlpha);
    waiting.forEach((r, i) => {
      r.position = i + 1;
      r.gapToLeaderMs = 0;
      r.gapToAheadMs = 0;
    });
    dnf.forEach((r, i) => {
      r.position = waiting.length + i + 1;
      r.gapToLeaderMs = 0;
      r.gapToAheadMs = 0;
    });
    return [...waiting, ...dnf];
  }

  const classified = rows.filter((r) => !r.isRetired && r.stagesCompleted === distance);
  const waiting = rows.filter((r) => !r.isRetired && r.stagesCompleted === 0);
  const mid = rows.filter((r) => !r.isRetired && r.stagesCompleted > 0 && r.stagesCompleted !== distance);
  const dnf = rows.filter((r) => r.isRetired);

  classified.sort((a, b) => a.totalMs - b.totalMs);
  mid.sort((a, b) => {
    if (a.stagesCompleted !== b.stagesCompleted) return b.stagesCompleted - a.stagesCompleted;
    return a.totalMs - b.totalMs;
  });
  waiting.sort(driverAlpha);
  dnf.sort(driverAlpha);

  const leaderMs = classified[0]?.totalMs ?? 0;
  classified.forEach((r, i) => {
    r.position = i + 1;
    r.gapToLeaderMs = r.totalMs - leaderMs;
    r.gapToAheadMs = i === 0 ? 0 : r.totalMs - classified[i - 1].totalMs;
  });
  const rest = [...mid, ...waiting, ...dnf];
  rest.forEach((r, i) => {
    r.position = classified.length + i + 1;
    r.gapToLeaderMs = 0;
    r.gapToAheadMs = 0;
  });
  return [...classified, ...rest];
}

export function fieldDistance<T extends { isRetired: boolean; stagesCompleted: number }>(rows: T[]): number {
  const running = rows.filter((r) => !r.isRetired);
  return running.reduce((m, r) => Math.max(m, r.stagesCompleted), 0);
}

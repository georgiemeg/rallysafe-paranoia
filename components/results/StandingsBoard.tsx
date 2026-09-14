"use client";

export interface BoardRow {
  position: number;
  number: number;
  carClass: string;
  driverName: string;
  codriverName: string;
  stagesCompleted: number;
  stagesTotal?: number;
  totalMs: number;
  gapToLeaderMs: number;
  gapToAheadMs: number;
  isRetired: boolean;
  isPenalized: boolean;
  penaltySecondsNet: number;
  ewrcDriverId?: number | null;
  ewrcCodriverId?: number | null;
  ewrcEntryId?: number;
  team?: string;
  tyre?: string;
  averageSpeed?: number | null;
  retiredReason?: string | null;
  hasIncompleteData?: boolean;
}

function msToClock(ms: number): string {
  const abs = Math.abs(ms) / 1000;
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`
    : `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

function gapLabel(ms: number): string {
  if (ms === 0) return "—";
  return `+${msToClock(ms)}`;
}

function carStyle(row: BoardRow): { color: string; filter?: string } {
  if (row.stagesCompleted > 0 && row.position === 1) {
    return { color: "#fbbf24", filter: row.isRetired ? undefined : "drop-shadow(0 0 7px rgba(251,191,36,0.9))" };
  }
  if (row.stagesCompleted > 0 && row.position === 2) {
    return { color: "#C0C0C0", filter: row.isRetired ? undefined : "drop-shadow(0 0 7px rgba(224,224,224,0.9))" };
  }
  if (row.stagesCompleted > 0 && row.position === 3) {
    return { color: "#CD7F32", filter: row.isRetired ? undefined : "drop-shadow(0 0 8px rgba(205,127,50,0.95))" };
  }
  return { color: "#00A8C4", filter: row.isRetired ? undefined : "drop-shadow(0 0 7px rgba(0,168,196,0.9))" };
}

function PosBadge({ row }: { row: BoardRow }) {
  if (row.position <= 3 && row.stagesCompleted > 0) {
    const bg =
      row.position === 1 ? "bg-amber-400 text-black" : row.position === 2 ? "bg-[#C0C0C0] text-black" : "bg-[#CD7F32] text-black";
    return <span className={`flex items-center justify-center w-6 h-6 rounded-full font-bold text-xs ${bg}`}>{row.position}</span>;
  }
  return <span className="text-neutral-500">{row.position}</span>;
}

function Flags({ row }: { row: BoardRow }) {
  return (
    <>
      {row.isRetired && <span className="text-neutral-500 text-xs">DNF{row.retiredReason ? ` — ${row.retiredReason}` : ""}</span>}
      {row.hasIncompleteData && !row.isRetired && (
        <span className="text-amber-400 text-xs" title="Missing a real time for at least one stage — total is provisional">
          ⚠ INCOMPLETE
        </span>
      )}
      {row.isPenalized && (
        <span className="text-red-400 text-xs font-bold drop-shadow-[0_0_6px_rgba(248,113,113,0.85)]">
          PEN
          {row.penaltySecondsNet !== 0 && (
            <span
              className={`ml-1 ${
                row.penaltySecondsNet > 0
                  ? "text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.85)]"
                  : "text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.85)]"
              }`}
            >
              {row.penaltySecondsNet > 0 ? "+" : "-"}
              {Math.abs(row.penaltySecondsNet)}
            </span>
          )}
        </span>
      )}
    </>
  );
}

function rowTone(row: BoardRow, serviceCarNumber: number | null, compareB?: number | null) {
  return `font-mono cursor-pointer hover:bg-white/[0.04] transition-colors ${row.isRetired ? "opacity-40" : ""} ${
    row.isPenalized
      ? "bg-[#CD7F32]/10"
      : row.stagesCompleted > 0 && row.position === 1
        ? "bg-amber-400/10"
        : row.stagesCompleted > 0 && row.position === 2
          ? "bg-[#C0C0C0]/10"
          : row.stagesCompleted > 0 && row.position === 3
            ? "bg-[#CD7F32]/10"
            : ""
  } ${serviceCarNumber === row.number ? "selected-row-tape" : ""} ${
    compareB === row.number ? "outline outline-1 outline-brand-gold/60" : ""
  }`;
}

export function StandingsBoard({
  title,
  rows,
  serviceCarNumber,
  compareB,
  onRowClick,
  onRowContext,
  onRowDouble,
  extended,
}: {
  title?: string;
  rows: BoardRow[];
  serviceCarNumber: number | null;
  compareB?: number | null;
  onRowClick: (n: number) => void;
  onRowContext?: (n: number) => void;
  onRowDouble?: (row: BoardRow) => void;
  /** Show Team / Tyre / Avg Speed columns — only meaningful for eWRC-sourced finished
   * events, which are the only source that actually has these per-row. */
  extended?: boolean;
}) {
  const anyTeam = Boolean(extended && rows.some((r) => r.team && r.team.trim()));
  const anyTyre = Boolean(extended && rows.some((r) => r.tyre && r.tyre.trim()));

  return (
    <div className={title ? "mb-6" : ""}>
      {title && (
        <h3 className="font-[family-name:var(--font-display)] text-base text-white tracking-tight mb-2">{title}</h3>
      )}

      {/* Mobile: stacked cards, no horizontal scroll */}
      <div className="md:hidden rounded-xl border border-white/10 bg-[#11151c] divide-y divide-white/5">
        {rows.map((row) => (
          <button
            key={row.number}
            type="button"
            className={`w-full text-left px-3 py-2.5 ${rowTone(row, serviceCarNumber, compareB)}`}
            onClick={() => onRowClick(row.number)}
            onDoubleClick={() => onRowDouble?.(row)}
          >
            <div className="flex items-start gap-3">
              <div className="pt-0.5 shrink-0">
                <PosBadge row={row} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold text-sm" style={carStyle(row)}>
                    #{row.number}
                  </span>
                  <span className="font-mono text-sm text-neutral-100 font-bold shrink-0">
                    {row.isRetired && !row.totalMs ? "DNF" : msToClock(row.totalMs)}
                  </span>
                </div>
                <div className="text-neutral-200 font-sans text-xs truncate">
                  {row.driverName} / {row.codriverName}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500">
                  {row.carClass && <span>{row.carClass}</span>}
                  <span>
                    {row.stagesCompleted}/{row.stagesTotal ?? row.stagesCompleted}
                  </span>
                  <span>Gap {gapLabel(row.gapToLeaderMs)}</span>
                  <Flags row={row} />
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Desktop: full-width table, wrap names, no forced min-width */}
      <div className="hidden md:block rounded-xl border border-white/10 bg-[#11151c]">
        <table className="w-full text-sm table-auto">
          <thead>
            <tr className="bg-white/[0.04] text-neutral-500 text-xs uppercase tracking-wide font-mono">
              <th className="text-left px-3 py-2 w-10">Pos</th>
              <th className="text-left px-3 py-2 w-24">Car</th>
              <th className="text-left px-3 py-2">Driver / Co-Driver</th>
              <th className="text-left px-3 py-2 hidden lg:table-cell">Class</th>
              {anyTeam && <th className="text-left px-3 py-2 hidden xl:table-cell">Team</th>}
              {anyTyre && <th className="text-left px-3 py-2 hidden xl:table-cell">Tyre</th>}
              <th className="text-right px-3 py-2">Stages</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-right px-3 py-2">Gap</th>
              <th className="text-right px-3 py-2 hidden xl:table-cell">Interval</th>
              {extended && <th className="text-right px-3 py-2 hidden xl:table-cell">Avg</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((row) => (
              <tr
                key={row.number}
                className={rowTone(row, serviceCarNumber, compareB)}
                onClick={() => onRowClick(row.number)}
                onContextMenu={(e) => {
                  if (!onRowContext) return;
                  e.preventDefault();
                  onRowContext(row.number);
                }}
                onDoubleClick={() => onRowDouble?.(row)}
              >
                <td className="px-3 py-2">
                  <PosBadge row={row} />
                </td>
                <td className="px-3 py-2">
                  <span className="font-bold" style={carStyle(row)}>
                    #{row.number}
                  </span>
                  <span className="ml-2 inline-flex flex-wrap gap-1">
                    <Flags row={row} />
                  </span>
                </td>
                <td className="px-3 py-2 text-neutral-200 font-sans text-xs">
                  {row.driverName} / {row.codriverName}
                </td>
                <td className="px-3 py-2 text-neutral-500 hidden lg:table-cell">{row.carClass}</td>
                {anyTeam && <td className="px-3 py-2 text-neutral-500 text-xs hidden xl:table-cell">{row.team}</td>}
                {anyTyre && <td className="px-3 py-2 text-neutral-500 text-xs hidden xl:table-cell">{row.tyre}</td>}
                <td className="px-3 py-2 text-right text-neutral-400 whitespace-nowrap">
                  {row.stagesCompleted}/{row.stagesTotal ?? row.stagesCompleted}
                </td>
                <td className="px-3 py-2 text-right text-neutral-100 font-bold whitespace-nowrap">
                  {row.isRetired && !row.totalMs ? "DNF" : msToClock(row.totalMs)}
                </td>
                <td className="px-3 py-2 text-right text-neutral-400 whitespace-nowrap">{gapLabel(row.gapToLeaderMs)}</td>
                <td className="px-3 py-2 text-right text-neutral-600 hidden xl:table-cell">{gapLabel(row.gapToAheadMs)}</td>
                {extended && (
                  <td className="px-3 py-2 text-right text-neutral-500 text-xs hidden xl:table-cell">
                    {row.averageSpeed ? `${row.averageSpeed.toFixed(1)} mph` : "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

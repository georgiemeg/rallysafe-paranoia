// All outbound SMS message formatting lives here so the exact wording is centralized
// and easy to audit/tweak in one place.
import type { CarSubscription } from "@/lib/store";
import type { StageTime, OverallResult, ResultsEntry } from "@/lib/rallysafe-results";

function fmtCarLabel(sub: Pick<CarSubscription, "carNumber" | "carClass">): string {
  return sub.carClass ? `#${sub.carNumber} (${sub.carClass})` : `#${sub.carNumber}`;
}

export function stageStartMessage(sub: CarSubscription, stageNumber: number, stageName?: string): string {
  const label = stageName || (stageNumber ? `SS${stageNumber}` : "");
  return `${sub.driverName} & ${sub.codriverName} in car ${fmtCarLabel(sub)} on stage${label ? ` (${label})` : ""}!`;
}

export function stageFinishMessage(sub: CarSubscription, stageNumber: number, stageName?: string): string {
  const label = stageName || (stageNumber ? `SS${stageNumber}` : "");
  return `${sub.driverName} & ${sub.codriverName} in car ${fmtCarLabel(sub)} ${label ? `${label} ` : ""}stage complete! *phew*`;
}

function msToClock(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds - minutes * 60).toFixed(1);
  return minutes > 0 ? `${minutes}:${seconds.padStart(4, "0")}` : `${seconds}s`;
}

function diffLabel(diffMs: number): string {
  if (diffMs === 0) return "even";
  const abs = msToClock(Math.abs(diffMs));
  return diffMs < 0 ? `${abs} FASTER 🔼` : `${abs} slower 🔽`;
}

export interface StageTimesContext {
  sub: CarSubscription;
  stageName: string; // e.g. "SS4 Steamboat 2"
  myTime: StageTime;
  priorPass?: { stageName: string; time: StageTime } | null; // e.g. SS2 Steamboat for SS4
  aheadOfMe: { entry: ResultsEntry; time: StageTime }[]; // up to 3, closest first
  behindMe: { entry: ResultsEntry; time: StageTime }[]; // up to 3, closest first
}

export function stageTimesMessage(ctx: StageTimesContext): string {
  const lines: string[] = [];
  const carLabel = fmtCarLabel(ctx.sub);
  lines.push(
    `Car ${carLabel} — ${ctx.stageName}: ${msToClock(ctx.myTime.elapsedDurationMs)} (${ctx.myTime.position}${ordinal(ctx.myTime.position)})`
  );

  if (ctx.priorPass) {
    const delta = ctx.myTime.elapsedDurationMs - ctx.priorPass.time.elapsedDurationMs;
    lines.push(
      `Previous pass (${ctx.priorPass.stageName}): ${msToClock(ctx.priorPass.time.elapsedDurationMs)} (${ctx.priorPass.time.position}${ordinal(ctx.priorPass.time.position)})`
    );
    lines.push(`↳ ${diffLabel(delta)} this time`);
  }

  const ssTag = ctx.stageName.match(/^SS\d+/i)?.[0] ?? ctx.stageName;

  if (ctx.aheadOfMe.length > 0) {
    lines.push("");
    lines.push(`Cars ahead of ${carLabel} on ${ssTag}:`);
    for (const { entry, time } of ctx.aheadOfMe) {
      const deltaToMe = ctx.myTime.elapsedDurationMs - time.elapsedDurationMs;
      lines.push(
        `#${entry.identifier} ${entry.driver.fullName}/${entry.codriver.fullName}: ${msToClock(time.elapsedDurationMs)} (${diffLabel(-deltaToMe).replace(" this time", "")})`
      );
    }
  }

  if (ctx.behindMe.length > 0) {
    lines.push("");
    lines.push(`Cars behind ${carLabel} on ${ssTag}:`);
    for (const { entry, time } of ctx.behindMe) {
      const deltaToMe = time.elapsedDurationMs - ctx.myTime.elapsedDurationMs;
      lines.push(
        `#${entry.identifier} ${entry.driver.fullName}/${entry.codriver.fullName}: ${msToClock(time.elapsedDurationMs)} (${diffLabel(deltaToMe).replace(" this time", "")})`
      );
    }
  }

  return lines.join("\n");
}

export interface OverallTimeContext {
  sub: CarSubscription;
  stageName: string;
  myResult: OverallResult;
  ahead: { entry: ResultsEntry; result: OverallResult }[]; // up to 3, closest first
  behind: { entry: ResultsEntry; result: OverallResult }[]; // up to 3, closest first
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

export function overallTimeMessage(ctx: OverallTimeContext): string {
  const carLabel = fmtCarLabel(ctx.sub);
  const lines: string[] = [];
  lines.push(
    `Overall after ${ctx.stageName} — Car ${carLabel} (${ctx.sub.driverName}/${ctx.sub.codriverName}): ` +
      `${ctx.myResult.position}${ordinal(ctx.myResult.position)}, ${msToClock(ctx.myResult.totalTimeMs)} ` +
      `(+${msToClock(ctx.myResult.diffFirstMs)} to leader)`
  );

  if (ctx.ahead.length > 0) {
    lines.push("");
    lines.push("Ahead:");
    for (const { entry, result } of ctx.ahead) {
      const deltaToMe = ctx.myResult.totalTimeMs - result.totalTimeMs;
      lines.push(
        `${result.position}${ordinal(result.position)} #${entry.identifier} ${lastNamePair(entry)} — ${msToClock(result.totalTimeMs)} (-${msToClock(deltaToMe)} to you)`
      );
    }
  }

  if (ctx.behind.length > 0) {
    lines.push("");
    lines.push("Behind:");
    for (const { entry, result } of ctx.behind) {
      const deltaToMe = result.totalTimeMs - ctx.myResult.totalTimeMs;
      lines.push(
        `${result.position}${ordinal(result.position)} #${entry.identifier} ${lastNamePair(entry)} — ${msToClock(result.totalTimeMs)} (+${msToClock(deltaToMe)} to you)`
      );
    }
  }

  return lines.join("\n");
}

function lastNamePair(entry: ResultsEntry): string {
  const d = entry.driver.fullName.split(" ").slice(-1)[0];
  const c = entry.codriver.fullName.split(" ").slice(-1)[0];
  return `${titleCase(d)}/${titleCase(c)}`;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function incidentMessage(sub: CarSubscription, minutesStopped: number, mapsLink: string): string {
  return (
    `RallySafe Paranoia alert:\n` +
    `Car ${fmtCarLabel(sub)} (${sub.driverName}) has not moved for ${minutesStopped}+ min.\n` +
    `Last known location: ${mapsLink}`
  );
}

export interface ServiceEstimateEntry {
  serviceNumber: number;
  due: string; // ISO-ish local timestamp
  durationMins?: number;
}

function clockFromIso(due: string, addMins = 0): string | null {
  const m = due.match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  let h = Number(m[1]);
  let min = Number(m[2]) + addMins;
  h += Math.floor(min / 60);
  min = ((min % 60) + 60) % 60;
  h = ((h % 24) + 24) % 24;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

/** Service Estimates alert — ARA events only. In and out, matching the example messages spec. */
export function serviceEstimatesMessage(sub: CarSubscription, estimates: ServiceEstimateEntry[]): string {
  const carLabel = fmtCarLabel(sub);
  const lines: string[] = [];
  lines.push(`Service Estimates — Car ${carLabel} (${sub.driverName}/${sub.codriverName}):`);
  if (estimates.length === 0) {
    lines.push("No predicted service times available yet.");
  } else {
    for (const s of estimates.sort((a, b) => a.serviceNumber - b.serviceNumber)) {
      const mins = s.durationMins && s.durationMins > 0 ? s.durationMins : 20;
      const inLabel = clockFromIso(s.due) ?? s.due;
      const outLabel = clockFromIso(s.due, mins) ?? inLabel;
      lines.push(`Service ${s.serviceNumber}: ~${inLabel} - out at ${outLabel}`);
    }
  }
  return lines.join("\n");
}

/** Joins multiple alert-type messages that fired in the same tick into one batched SMS. */
export function batchMessages(messages: string[]): string {
  return messages.filter(Boolean).join("\n====================\n");
}

export const HELP_MESSAGE = [
  "RallySafe Paranoia — text commands:",
  "",
  "HELP — show this message",
  "OVERALL TIME CHECK — get current overall standings for all tracked cars",
  "STAGE TIME CHECK — get latest stage time for all tracked cars",
  "SERVICE CHECK — get upcoming service in/out estimates for all tracked cars",
  "CAR <number> CLASS ONLY — switch that car's comparisons to only show competitors in its class",
  "CAR <number> ALL CLASSES — switch back to comparing against all classes",
  "",
  "Example: CAR 25 CLASS ONLY",
  "",
  "Msg & data rates may apply. Reply STOP to cancel anytime.",
].join("\n");

import {
  getAllDeviceSubscriptions,
  updateClassScope,
} from "@/lib/store";
import { getEntries } from "@/lib/rallysafe";
import { buildStageTimesMessage, buildOverallTimeMessage } from "@/lib/rally-engine";
import { batchMessages, HELP_MESSAGE } from "@/lib/messages";
import { overallTimeCheck, stageTimeCheck, serviceCheck } from "@/lib/command-times";

async function findLatestStageNumberForCar(
  eventId: number,
  entryId: number
): Promise<number | null> {
  try {
    const entries = await getEntries(eventId);
    const live = entries.find((e) => e.entryId === entryId);
    if (!live) return null;
    return live.stageNumber > 0 ? live.stageNumber : null;
  } catch {
    return null;
  }
}

export async function runCommand(deviceId: string, raw: string): Promise<string> {
  const text = raw.trim().toLowerCase();
  if (!text) return "Type a command, or HELP for the list.";

  if (text === "help") return HELP_MESSAGE;

  const classCmdMatch = text.match(/^car\s+(\S+)\s+(class only|all classes)$/i);
  if (classCmdMatch) {
    const carNumber = classCmdMatch[1];
    const wantsClassOnly = classCmdMatch[2].toLowerCase() === "class only";

    const allSubs = await getAllDeviceSubscriptions(deviceId);
    const matches = allSubs.filter((s) => s.carNumber === carNumber);

    if (matches.length === 0) return `You're not tracking car #${carNumber}.`;
    if (matches.length > 1) {
      return `Car #${carNumber} is tracked across multiple events — this command isn't supported for ambiguous matches yet.`;
    }

    const sub = matches[0];
    const updated = await updateClassScope(sub.eventId, sub.entryId, deviceId, wantsClassOnly);
    if (!updated) return "Couldn't update that subscription.";

    const latestStage = await findLatestStageNumberForCar(sub.eventId, sub.entryId);
    const pushMessages: string[] = [];
    if (latestStage) {
      const [stageMsg, overallMsg] = await Promise.all([
        buildStageTimesMessage(updated, latestStage).catch(() => null),
        buildOverallTimeMessage(updated, latestStage).catch(() => null),
      ]);
      if (stageMsg) pushMessages.push(stageMsg);
      if (overallMsg) pushMessages.push(overallMsg);
    } else {
      const overall = await overallTimeCheck([updated]);
      if (!overall.startsWith("No completed")) pushMessages.push(overall);
    }

    const scopeLabel = wantsClassOnly ? `class (${updated.carClass}) only` : "all classes";
    const confirmation = `Car #${carNumber} comparisons switched to ${scopeLabel}.`;
    return batchMessages([confirmation, ...pushMessages]);
  }

  if (text === "overall time check") {
    let allSubs = await getAllDeviceSubscriptions(deviceId);
    if (allSubs.some((s) => s.eventId === 20251925)) allSubs = allSubs.filter((s) => s.eventId === 20251925);
    if (allSubs.length === 0) return "You're not tracking any cars yet.";
    return overallTimeCheck(allSubs);
  }

  if (text === "stage time check") {
    let allSubs = await getAllDeviceSubscriptions(deviceId);
    if (allSubs.some((s) => s.eventId === 20251925)) allSubs = allSubs.filter((s) => s.eventId === 20251925);
    if (allSubs.length === 0) return "You're not tracking any cars yet.";
    return stageTimeCheck(allSubs);
  }

  if (text === "service check") {
    let allSubs = await getAllDeviceSubscriptions(deviceId);
    if (allSubs.some((s) => s.eventId === 20251925)) allSubs = allSubs.filter((s) => s.eventId === 20251925);
    if (allSubs.length === 0) return "You're not tracking any cars yet.";
    return serviceCheck(allSubs);
  }

  return "Command not recognized. Type HELP for a list of commands.";
}

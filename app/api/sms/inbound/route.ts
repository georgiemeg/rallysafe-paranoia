import { NextRequest, NextResponse } from "next/server";
import {
  findDeviceByPhone,
  getAllDeviceSubscriptions,
  updateClassScope,
} from "@/lib/store";
import { getEntries } from "@/lib/rallysafe";
import { buildStageTimesMessage, buildOverallTimeMessage } from "@/lib/rally-engine";
import { batchMessages, HELP_MESSAGE } from "@/lib/messages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Twilio posts inbound SMS as application/x-www-form-urlencoded with From/Body fields.
async function parseTwilioBody(req: NextRequest): Promise<{ from: string; body: string }> {
  const form = await req.formData();
  return {
    from: String(form.get("From") ?? ""),
    body: String(form.get("Body") ?? ""),
  };
}

function twiml(message?: string): NextResponse {
  const xml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new NextResponse(xml, { headers: { "Content-Type": "text/xml" } });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Finds the most recent stage number a car has actually completed, by scanning live state
 * across all events this device is subscribed to for that car. */
async function findLatestStageNumberForCar(eventId: number, entryId: number): Promise<number | null> {
  try {
    const entries = await getEntries(eventId);
    const live = entries.find((e) => e.entryId === entryId);
    if (!live) return null;
    // If currently racing, the last COMPLETED stage is stageNumber - 1 (unless not yet on
    // any stage, i.e. still in pre-event/service). If not racing, stageNumber itself is the
    // last one they were on, which — combined with racingStatus 0 — means it's completed.
    return live.stageNumber > 0 ? live.stageNumber : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { from, body } = await parseTwilioBody(req);
  const text = body.trim().toLowerCase();

  const device = await findDeviceByPhone(from);
  if (!device) {
    return twiml("This number isn't registered with RallySafe Paranoia. Set up tracking at the web app first.");
  }

  // HELP
  if (text === "help") {
    return twiml(HELP_MESSAGE);
  }

  // CAR <number> CLASS ONLY / CAR <number> ALL CLASSES
  const classCmdMatch = text.match(/^car\s+(\S+)\s+(class only|all classes)$/i);
  if (classCmdMatch) {
    const carNumber = classCmdMatch[1];
    const wantsClassOnly = classCmdMatch[2].toLowerCase() === "class only";

    const allSubs = await getAllDeviceSubscriptions(device.deviceId);
    const matches = allSubs.filter((s) => s.carNumber === carNumber);

    if (matches.length === 0) {
      return twiml(`You're not tracking car #${carNumber}.`);
    }
    if (matches.length > 1) {
      return twiml(
        `Car #${carNumber} is tracked across multiple events — this command isn't supported for ambiguous matches yet.`
      );
    }

    const sub = matches[0];
    const updated = await updateClassScope(sub.eventId, sub.entryId, device.deviceId, wantsClassOnly);
    if (!updated) {
      return twiml("Couldn't update that subscription.");
    }

    // Per spec: switching scope should immediately push fresh overall + stage times.
    const latestStage = await findLatestStageNumberForCar(sub.eventId, sub.entryId);
    const pushMessages: string[] = [];
    if (latestStage) {
      const [stageMsg, overallMsg] = await Promise.all([
        buildStageTimesMessage(updated, latestStage).catch(() => null),
        buildOverallTimeMessage(updated, latestStage).catch(() => null),
      ]);
      if (stageMsg) pushMessages.push(stageMsg);
      if (overallMsg) pushMessages.push(overallMsg);
    }

    const scopeLabel = wantsClassOnly ? `class (${updated.carClass}) only` : "all classes";
    const confirmation = `Car #${carNumber} comparisons switched to ${scopeLabel}.`;
    return twiml(batchMessages([confirmation, ...pushMessages]));
  }

  // OVERALL TIME CHECK
  if (text === "overall time check") {
    const allSubs = await getAllDeviceSubscriptions(device.deviceId);
    if (allSubs.length === 0) return twiml("You're not tracking any cars yet.");

    const messages: string[] = [];
    for (const sub of allSubs) {
      const latestStage = await findLatestStageNumberForCar(sub.eventId, sub.entryId);
      if (!latestStage) continue;
      const msg = await buildOverallTimeMessage(sub, latestStage).catch(() => null);
      if (msg) messages.push(msg);
    }
    if (messages.length === 0) return twiml("No completed stages yet to report on.");
    return twiml(batchMessages(messages));
  }

  // STAGE TIME CHECK
  if (text === "stage time check") {
    const allSubs = await getAllDeviceSubscriptions(device.deviceId);
    if (allSubs.length === 0) return twiml("You're not tracking any cars yet.");

    const messages: string[] = [];
    for (const sub of allSubs) {
      const latestStage = await findLatestStageNumberForCar(sub.eventId, sub.entryId);
      if (!latestStage) continue;
      const msg = await buildStageTimesMessage(sub, latestStage).catch(() => null);
      if (msg) messages.push(msg);
    }
    if (messages.length === 0) return twiml("No completed stages yet to report on.");
    return twiml(batchMessages(messages));
  }

  return twiml(`Command not recognized. Text HELP for a list of commands.`);
}

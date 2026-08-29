import { NextRequest, NextResponse } from "next/server";
import { getEntries } from "@/lib/rallysafe";
import {
  getActiveEventIds,
  getWatchedEntryIds,
  getLiveState,
  setLiveState,
  getResultsSentState,
  setResultsSentState,
  getSubscribersForCar,
  getCarSubscription,
  type LiveTrackState,
} from "@/lib/store";
import { sendSms } from "@/lib/sms";
import {
  stageStartMessage,
  stageFinishMessage,
  incidentMessage,
  batchMessages,
} from "@/lib/messages";
import { buildStageTimesMessage, buildOverallTimeMessage } from "@/lib/rally-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STOPPED_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
const POSITION_EPSILON = 0.00003; // ~3-5m of GPS jitter tolerance

function movedSincePrev(prev: LiveTrackState, lat: number, lng: number, speed: number): boolean {
  if (speed > 1) return true;
  const dLat = Math.abs(lat - prev.lat);
  const dLng = Math.abs(lng - prev.lng);
  return dLat > POSITION_EPSILON || dLng > POSITION_EPSILON;
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown>[] = [];
  const activeEventIds = await getActiveEventIds();

  for (const eventId of activeEventIds) {
    const watchedEntryIds = await getWatchedEntryIds(eventId);
    if (watchedEntryIds.length === 0) continue;

    let entries;
    try {
      entries = await getEntries(eventId);
    } catch (err) {
      console.error(`Failed to fetch entries for event ${eventId}`, err);
      continue;
    }
    const byEntryId = new Map(entries.map((e) => [e.entryId, e]));

    for (const entryId of watchedEntryIds) {
      const live = byEntryId.get(entryId);
      if (!live) continue;

      const prev = await getLiveState(eventId, entryId);
      const now = Date.now();

      // --- Incident (stopped-car) detection, same logic as before ---
      const isMoving = prev ? movedSincePrev(prev, live.lat, live.lng, live.speed) : live.speed > 1;
      let stoppedSinceTs: number | null;
      let alertSentForThisStop: boolean;
      if (isMoving) {
        stoppedSinceTs = null;
        alertSentForThisStop = false;
      } else {
        stoppedSinceTs = prev?.stoppedSinceTs ?? now;
        alertSentForThisStop = prev?.alertSentForThisStop ?? false;
      }
      const stoppedDurationMs = stoppedSinceTs ? now - stoppedSinceTs : 0;
      const shouldAlertIncident =
        !isMoving && stoppedDurationMs >= STOPPED_THRESHOLD_MS && !alertSentForThisStop;

      // --- Stage start/finish detection via stageNumber + racingStatus transitions ---
      const prevStageNumber = prev?.lastKnownStageNumber ?? 0;
      const prevRacingStatus = prev?.lastKnownRacingStatus ?? 0;
      const currentStageNumber = live.stageNumber ?? 0;
      const currentRacingStatus = live.racingStatus ?? 0;

      // Entered a stage: racingStatus flips 0 -> 1 (on-stage) while on a real stage number
      const justStartedStage =
        prevRacingStatus === 0 && currentRacingStatus === 1 && currentStageNumber > 0;
      // Left a stage: racingStatus flips 1 -> 0 (finished/exited stage) — this is our
      // "stage finished" signal; the actual official time comes from the Results API.
      const justFinishedStage =
        prevRacingStatus === 1 && currentRacingStatus === 0 && prevStageNumber > 0;
      const finishedStageNumber = justFinishedStage ? prevStageNumber : null;

      const subscriberIds = await getSubscribersForCar(eventId, entryId);

      for (const deviceId of subscriberIds) {
        const sub = await getCarSubscription(eventId, entryId, deviceId);
        if (!sub) continue;
        const device = await import("@/lib/store").then((m) => m.getDevice(deviceId));
        if (!device?.phone) continue;

        const messagesToSend: string[] = [];

        if (sub.alerts.stageStart && justStartedStage) {
          messagesToSend.push(stageStartMessage(sub));
        }

        if (sub.alerts.stageFinish && justFinishedStage) {
          messagesToSend.push(stageFinishMessage(sub));
        }

        if (sub.alerts.stageTimes && justFinishedStage && finishedStageNumber) {
          // Results may take a few polls to appear after the raw finish signal; we retry
          // on subsequent ticks by checking resultsSentState (won't double-send once caught).
          const resultsState = await getResultsSentState(eventId, entryId);
          const alreadySent = resultsState?.stageTimesSentForStage.includes(finishedStageNumber);
          if (!alreadySent) {
            try {
              const msg = await buildStageTimesMessage(sub, finishedStageNumber);
              if (msg) {
                messagesToSend.push(msg);
                await setResultsSentState({
                  entryId,
                  eventId,
                  stageTimesSentForStage: [
                    ...(resultsState?.stageTimesSentForStage ?? []),
                    finishedStageNumber,
                  ],
                  overallSentForStage: resultsState?.overallSentForStage ?? [],
                });
              }
            } catch (err) {
              console.error(`stageTimes build failed for entry ${entryId} stage ${finishedStageNumber}`, err);
            }
          }
        }

        if (sub.alerts.overallTime && justFinishedStage && finishedStageNumber) {
          const resultsState = await getResultsSentState(eventId, entryId);
          const alreadySent = resultsState?.overallSentForStage.includes(finishedStageNumber);
          if (!alreadySent) {
            try {
              const msg = await buildOverallTimeMessage(sub, finishedStageNumber);
              if (msg) {
                messagesToSend.push(msg);
                await setResultsSentState({
                  entryId,
                  eventId,
                  stageTimesSentForStage: resultsState?.stageTimesSentForStage ?? [],
                  overallSentForStage: [
                    ...(resultsState?.overallSentForStage ?? []),
                    finishedStageNumber,
                  ],
                });
              }
            } catch (err) {
              console.error(`overallTime build failed for entry ${entryId} stage ${finishedStageNumber}`, err);
            }
          }
        }

        if (sub.alerts.incidentDetection && shouldAlertIncident) {
          const minutesStopped = Math.round(stoppedDurationMs / 60000);
          const mapsLink = `https://maps.google.com/?q=${live.lat},${live.lng}`;
          messagesToSend.push(incidentMessage(sub, minutesStopped, mapsLink));
        }

        if (messagesToSend.length > 0) {
          try {
            await sendSms(device.phone, batchMessages(messagesToSend));
            results.push({ eventId, entryId, deviceId, sentCount: messagesToSend.length });
          } catch (err) {
            console.error(`Failed to SMS device ${deviceId}`, err);
          }
        }
      }

      await setLiveState({
        entryId,
        eventId,
        lat: live.lat,
        lng: live.lng,
        speed: live.speed,
        lastMessageTimestamp: live.lastMessageTimestamp,
        stoppedSinceTs,
        alertSentForThisStop: shouldAlertIncident ? true : alertSentForThisStop,
        lastKnownStageNumber: currentStageNumber,
        lastKnownRacingStatus: currentRacingStatus,
      });
    }
  }

  return NextResponse.json({ ok: true, sentBatches: results.length, results });
}

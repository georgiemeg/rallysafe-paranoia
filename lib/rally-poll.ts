import { getEntries } from "@/lib/rallysafe";
import {
  getWatchedEntryIds,
  getLiveState,
  setLiveState,
  getResultsSentState,
  setResultsSentState,
  getSubscribersForCar,
  getCarSubscription,
  getDevice,
  claimAlert,
  type InboxMessage,
  type CarSubscription,
} from "@/lib/store";
import { deliverAlert } from "@/lib/deliver";
import { stageStartMessage, stageFinishMessage, incidentMessage, serviceEstimatesMessage, batchMessages } from "@/lib/messages";
import { buildStageTimesMessage, buildOverallTimeMessage } from "@/lib/rally-engine";
import { serviceEstimatesForCar, eventNameForId } from "@/lib/combiner";

const STOPPED_THRESHOLD_MS = 60 * 1000;
const SPEED_STOPPED_MAX = 5;
const SPEED_REARM_MIN = 15;
const MOVE_RESET_METRES = 15;
const REARM_METRES = 40;
const GPS_MAX_AGE_MS = 20 * 1000;
const MIN_QUALIFYING_PACKETS = 3;

async function stageNameFor(sub: CarSubscription, stageNumber: number): Promise<string | undefined> {
  if (!stageNumber) return undefined;
  try {
    if (sub.eventId === 20251925) {
      const itinerary = (await import("@/lib/sim/seed/itinerary.json")).default as { n: number; name: string }[];
      return itinerary.find((s) => s.n === stageNumber)?.name;
    }
    const { getStageNameForSub } = await import("@/lib/rally-engine");
    return await getStageNameForSub(sub, stageNumber);
  } catch {
    return undefined;
  }
}

function gpsAgeMs(lastMessageTimestamp: string, now: number): number | null {
  if (!lastMessageTimestamp || lastMessageTimestamp.startsWith("0001-")) return null;
  const raw = /Z$/.test(lastMessageTimestamp) ? lastMessageTimestamp : `${lastMessageTimestamp}Z`;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return now - t;
}

function metresBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export async function processWatchedEvent(eventId: number, onlyEntryId?: number) {
  const results: Record<string, unknown>[] = [];
  let watchedEntryIds = await getWatchedEntryIds(eventId);
  if (onlyEntryId) watchedEntryIds = watchedEntryIds.filter((id) => id === onlyEntryId);
  if (watchedEntryIds.length === 0) return results;

  let entries;
  try {
    entries = await getEntries(eventId);
  } catch (err) {
    console.error(`Failed to fetch entries for event ${eventId}`, err);
    return results;
  }
  const byEntryId = new Map(entries.map((e) => [e.entryId, e]));

  for (const entryId of watchedEntryIds) {
    const subscriberIds = await getSubscribersForCar(eventId, entryId);
    if (subscriberIds.length === 0) continue;
    const live = byEntryId.get(entryId);
    if (!live) continue;

    const prev = await getLiveState(eventId, entryId);
    const now = Date.now();
    const currentStageNumber = live.stageNumber ?? 0;
    const currentRacingStatus = live.racingStatus ?? 0;
    const onStageRacing = currentRacingStatus === 1 && currentStageNumber > 0;
    const speedLow = (live.speed ?? 0) < SPEED_STOPPED_MAX;
    const hasFix = Number.isFinite(live.lat) && Number.isFinite(live.lng) && !(live.lat === 0 && live.lng === 0);
    const age = gpsAgeMs(live.lastMessageTimestamp, now);
    const gpsFresh = age !== null && age >= 0 && age <= GPS_MAX_AGE_MS;

    let stoppedSinceTs: number | null = null;
    let stopOriginLat: number | null = null;
    let stopOriginLng: number | null = null;
    let alertSentForThisStop = false;
    let incidentQualifyCount = 0;

    const qualifying = onStageRacing && speedLow && hasFix && gpsFresh;

    if (qualifying) {
      const originLat = prev?.stopOriginLat ?? prev?.lat ?? live.lat;
      const originLng = prev?.stopOriginLng ?? prev?.lng ?? live.lng;
      const movedOffSpot =
        prev?.stoppedSinceTs != null && metresBetween(originLat, originLng, live.lat, live.lng) > MOVE_RESET_METRES;
      if (movedOffSpot) {
        stoppedSinceTs = now;
        stopOriginLat = live.lat;
        stopOriginLng = live.lng;
        alertSentForThisStop = false;
        incidentQualifyCount = 1;
      } else if (prev?.stoppedSinceTs) {
        stoppedSinceTs = prev.stoppedSinceTs;
        stopOriginLat = originLat;
        stopOriginLng = originLng;
        alertSentForThisStop = prev.alertSentForThisStop ?? false;
        incidentQualifyCount = (prev.incidentQualifyCount ?? 0) + 1;
      } else {
        stoppedSinceTs = now;
        stopOriginLat = live.lat;
        stopOriginLng = live.lng;
        alertSentForThisStop = false;
        incidentQualifyCount = 1;
      }
    } else if (prev?.alertSentForThisStop && hasFix && prev.stopOriginLat != null && prev.stopOriginLng != null) {
      const moved = metresBetween(prev.stopOriginLat, prev.stopOriginLng, live.lat, live.lng) >= REARM_METRES;
      const fast = (live.speed ?? 0) >= SPEED_REARM_MIN;
      if (!(moved && fast)) {
        alertSentForThisStop = true;
        stoppedSinceTs = prev.stoppedSinceTs;
        stopOriginLat = prev.stopOriginLat;
        stopOriginLng = prev.stopOriginLng;
        incidentQualifyCount = prev.incidentQualifyCount ?? 0;
      }
    }

    const stoppedDurationMs = stoppedSinceTs ? now - stoppedSinceTs : 0;
    let shouldAlertIncident =
      qualifying &&
      stoppedDurationMs > STOPPED_THRESHOLD_MS &&
      incidentQualifyCount >= MIN_QUALIFYING_PACKETS &&
      !alertSentForThisStop;

    // Claim + mark the incident BEFORE persisting state or delivering, so overlapping
    // cron ticks can't both fire the same stop (same race start/finish alerts are
    // already protected against via claimAlert above).
    if (shouldAlertIncident) {
      const claimed = await claimAlert(`alert:incident:${eventId}:${entryId}:${stoppedSinceTs ?? 0}`);
      if (claimed) {
        alertSentForThisStop = true;
      } else {
        shouldAlertIncident = false;
      }
    }

    const prevStageNumber = prev?.lastKnownStageNumber ?? 0;
    const prevRacingStatus = prev?.lastKnownRacingStatus ?? 0;
    const postedMs = Number((live as { stageTimeMs?: number }).stageTimeMs || 0);
    let justStartedStage = prevRacingStatus === 0 && currentRacingStatus === 1 && currentStageNumber > 0;
    // Finish is 1→0 AND a real posted stage time on this packet. A status flicker
    // (hold, transit, catch-up) with stageTimeMs 0 is not a finish — that's how
    // alerts were firing while the car was still on the stage.
    let justFinishedStage =
      prevRacingStatus === 1 && currentRacingStatus === 0 && prevStageNumber > 0 && postedMs > 0;
    if (justStartedStage) {
      justStartedStage = await claimAlert(`alert:start:${eventId}:${entryId}:${currentStageNumber}`);
    }
    if (justFinishedStage) {
      justFinishedStage = await claimAlert(`alert:finish:${eventId}:${entryId}:${prevStageNumber}`);
    }
    const finishedStageNumber = justFinishedStage ? prevStageNumber : null;

    if (justFinishedStage && finishedStageNumber) {
      const ms = postedMs;
      if (ms > 0) {
        const { recordPostedTime } = await import("@/lib/sim/engine");
        await recordPostedTime(String(live.identifier), finishedStageNumber, ms);
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
      stopOriginLat,
      stopOriginLng,
      alertSentForThisStop,
      incidentQualifyCount,
      lastKnownStageNumber: currentStageNumber,
      lastKnownRacingStatus: currentRacingStatus,
    });

    for (const deviceId of subscriberIds) {
      const sub = await getCarSubscription(eventId, entryId, deviceId);
      if (!sub) continue;
      const device = await getDevice(deviceId);
      if (!device) continue;

      const queue: { kind: InboxMessage["alertType"]; body: string }[] = [];

      if (sub.alerts.stageStart && justStartedStage) {
        const stageName = await stageNameFor(sub, currentStageNumber);
        queue.push({ kind: "stageStart", body: stageStartMessage(sub, currentStageNumber, stageName) });
      }
      if (sub.alerts.stageFinish && justFinishedStage) {
        const finStage = finishedStageNumber || prevStageNumber;
        const stageName = await stageNameFor(sub, finStage);
        queue.push({ kind: "stageFinish", body: stageFinishMessage(sub, finStage, stageName) });
      }
      const resultsState = await getResultsSentState(eventId, entryId);
      const timesSent = new Set(resultsState?.stageTimesSentForStage ?? []);
      const overallSent = new Set(resultsState?.overallSentForStage ?? []);
      const serviceSent = new Set(resultsState?.serviceSentForStage ?? []);
      const dueStages: number[] = [];
      if (justFinishedStage && finishedStageNumber) dueStages.push(finishedStageNumber);
      if (eventId === 20251925) {
        const { getSimState } = await import("@/lib/sim/engine");
        const posted = (await getSimState()).postedTimes || {};
        for (const [k, byCar] of Object.entries(posted)) {
          const n = Number(k);
          if (!Number.isFinite(n) || n < 1) continue;
          if (byCar && typeof byCar === "object" && (byCar as Record<string, number>)[sub.carNumber] != null) dueStages.push(n);
        }
      }
      const stagesToNotify = [...new Set(dueStages)].sort((a, b) => a - b);
      for (const n of stagesToNotify) {
        if (sub.alerts.stageTimes && !timesSent.has(n)) {
          try {
            const msg = await buildStageTimesMessage(sub, n);
            if (msg) {
              queue.push({ kind: "stageTimes", body: msg });
              timesSent.add(n);
            }
          } catch (err) {
            console.error(`stageTimes build failed for entry ${entryId} stage ${n}`, err);
          }
        }
        if (sub.alerts.overallTime && !overallSent.has(n)) {
          try {
            const msg = await buildOverallTimeMessage(sub, n);
            if (msg) {
              queue.push({ kind: "overallTime", body: msg });
              overallSent.add(n);
            }
          } catch (err) {
            console.error(`overallTime build failed for entry ${entryId} stage ${n}`, err);
          }
        }
        if (sub.alerts.serviceEstimates && !serviceSent.has(n)) {
          const estimates =
            eventId === 20251925
              ? await (async () => {
                  const { simServiceEstimatesFor } = await import("@/lib/sim/engine");
                  return simServiceEstimatesFor(sub.carNumber, n);
                })()
              : await (async () => {
                  const name = await eventNameForId(eventId);
                  if (!name) return null;
                  return serviceEstimatesForCar(name, sub.carNumber);
                })();
          if (estimates && estimates.length) {
            queue.push({ kind: "serviceEstimates", body: serviceEstimatesMessage(sub, estimates) });
            serviceSent.add(n);
          }
        }
      }
      if (timesSent.size !== (resultsState?.stageTimesSentForStage ?? []).length ||
          overallSent.size !== (resultsState?.overallSentForStage ?? []).length ||
          serviceSent.size !== (resultsState?.serviceSentForStage ?? []).length) {
        await setResultsSentState({
          entryId,
          eventId,
          stageTimesSentForStage: [...timesSent],
          overallSentForStage: [...overallSent],
          serviceSentForStage: [...serviceSent],
        });
      }
      if (sub.alerts.incidentDetection && shouldAlertIncident) {
        const minutesStopped = Math.round(stoppedDurationMs / 60000);
        const mapsLink = `https://maps.google.com/?q=${live.lat},${live.lng}`;
        queue.push({ kind: "incidentDetection", body: incidentMessage(sub, minutesStopped, mapsLink) });
      }

      if (queue.length > 0) {
        try {
          let phone = device.phone;
          if (eventId === 20251925) {
            const { getSimState } = await import("@/lib/sim/engine");
            if (!(await getSimState()).smsLive) phone = "";
          }
          if (queue.length === 1) {
            const delivered = await deliverAlert({
              deviceId,
              phone,
              eventId,
              entryId,
              carNumber: sub.carNumber,
              alertType: queue[0].kind,
              body: queue[0].body,
            });
            results.push({ eventId, entryId, deviceId, sentCount: 1, sms: delivered.sms, kind: queue[0].kind });
          } else {
            const combined = batchMessages(queue.map((q) => q.body));
            for (const item of queue) {
              await deliverAlert({
                deviceId,
                phone: "",
                eventId,
                entryId,
                carNumber: sub.carNumber,
                alertType: item.kind,
                body: item.body,
              });
            }
            const delivered = await deliverAlert({
              deviceId,
              phone,
              eventId,
              entryId,
              carNumber: sub.carNumber,
              alertType: queue[0].kind,
              body: combined,
              inbox: false,
            });
            results.push({ eventId, entryId, deviceId, sentCount: queue.length, sms: delivered.sms, kind: "batch" });
          }
        } catch (err) {
          console.error(`Failed to deliver alert to device ${deviceId}`, err);
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
      stopOriginLat,
      stopOriginLng,
      alertSentForThisStop: shouldAlertIncident ? true : alertSentForThisStop,
      incidentQualifyCount,
      lastKnownStageNumber: currentStageNumber,
      lastKnownRacingStatus: currentRacingStatus,
    });
  }
  return results;
}

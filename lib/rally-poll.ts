import { getEntries, listStages } from "@/lib/rallysafe";
import { getStageTimes as getRcStageTimes } from "@/lib/rallysafe-rc-overall";
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
import { stageStartMessage, stageFinishMessage, incidentMessage, safetyStatusMessage, serviceEstimatesMessage, batchMessages } from "@/lib/messages";
import { buildStageTimesMessage, buildOverallTimeMessage } from "@/lib/rally-engine";
import { serviceEstimatesForCar, eventNameForId } from "@/lib/combiner";
import { getActiveServiceAfterStages } from "@/lib/sportity";

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

  // Overmountain 2026 (and a few other events) never populate the per-car stageNumber in the
  // live entry feed — every car reports 0. The alert pipeline keys stage detection off that
  // field, so without this fallback nothing ever fires. The rc times feed DOES update, so we
  // scan each scored stage once per poll and map car number -> posted time, then use that in
  // the per-entry loop below to discover finished stages.
  const liveHasStageNumbers = entries.some((e) => (e.stageNumber ?? 0) > 0);
  const rcStageTimes = new Map<number, Map<string, number>>(); // stageNumber -> car -> timeMs
  const rcStageNames = new Map<number, string>();
  if (eventId !== 20251925 && !liveHasStageNumbers) {
    try {
      const stages = await listStages(eventId);
      for (const s of stages) {
        if (s.isTransit || (s.status !== 3 && s.status !== 4)) continue;
        rcStageNames.set(s.number, s.name);
        const times = await getRcStageTimes(s.locationGroupId);
        const byCar = new Map<string, number>();
        for (const t of times) {
          if ((t.stageTime ?? 0) > 0 && /^\d+$/.test(String(t.identifier))) {
            byCar.set(String(t.identifier), t.stageTime);
          }
        }
        rcStageTimes.set(s.number, byCar);
      }
    } catch (err) {
      console.error(`rc stage-times fallback scan failed for event ${eventId}`, err);
    }
  }

  // Service estimates fire only after the final stage before a service. The active event
  // config lists those stage numbers ("serviceAfterStagesCsv"), e.g. "2,7,10" = services
  // follow stages 2, 7 and 10. Unset config keeps the old always-on behavior.
  const serviceAfterStages =
    eventId === 20251925 ? null : await getActiveServiceAfterStages().catch(() => null);

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
    const gpsStatus = Number((live as { gpsStatus?: number }).gpsStatus ?? 0);
    const hasFix = gpsStatus > 0 || (Number.isFinite(live.lat) && Number.isFinite(live.lng) && !(live.lat === 0 && live.lng === 0));
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
    // The unit's own safety flag is the authoritative incident signal: it's set when the
    // car stops on stage (auto-hazard), when the crew presses OK/HAZARD/SOS, or on a
    // high-G impact (auto-SOS). 0 = none, 1 = OK, 2 = hazard, 3 = SOS. Hazard/SOS is an
    // immediate incident; otherwise we fall back to the stationary heuristic below.
    const safetyStatus = Number((live as { safetyStatus?: number }).safetyStatus ?? 0);
    const unitSafetyEvent = safetyStatus >= 2;
    let incidentIsSafetyEvent = false;
    let safetyStatusValue = 0;
    let shouldAlertIncident =
      qualifying &&
      stoppedDurationMs > STOPPED_THRESHOLD_MS &&
      incidentQualifyCount >= MIN_QUALIFYING_PACKETS &&
      !alertSentForThisStop;

    if (unitSafetyEvent) {
      shouldAlertIncident = true;
      incidentIsSafetyEvent = true;
      safetyStatusValue = safetyStatus;
      console.info("RallySafe safety flag observed", {
        eventId,
        entryId,
        car: live.identifier,
        safetyStatus,
        racingStatus: currentRacingStatus,
        speed: live.speed,
        stageNumber: currentStageNumber,
      });
    }

    // Claim + mark the incident BEFORE persisting state or delivering, so overlapping
    // cron ticks can't both fire the same stop (same race start/finish alerts are
    // already protected against via claimAlert above).
    if (shouldAlertIncident) {
      const claimed = await claimAlert(
        incidentIsSafetyEvent
          ? `alert:safety:${eventId}:${entryId}:${currentStageNumber}:${safetyStatus}`
          : `alert:incident:${eventId}:${entryId}:${stoppedSinceTs ?? 0}`
      );
      if (claimed) {
        alertSentForThisStop = true;
      } else {
        shouldAlertIncident = false;
      }
    }

    const prevStageNumber = prev?.lastKnownStageNumber ?? 0;
    const prevRacingStatus = prev?.lastKnownRacingStatus ?? 0;
    const pendingFinish = prev?.pendingFinishStage ?? 0;
    const postedMs = Number((live as { stageTimeMs?: number }).stageTimeMs || 0);
    let justStartedStage = prevRacingStatus === 0 && currentRacingStatus === 1 && currentStageNumber > 0;

    // Finish = racingStatus 1→0, but a brief blip (hold/transit) can flicker 1→0→1 while the
    // car is still on the stage, which used to fire a false "finished" and then suppress the
    // real one via the claim. For real events we debounce: hold the 1→0 edge for one poll and
    // only confirm it if the car stays off stage (or moves to a LATER stage) on the next poll.
    // The sim (controlled, no flicker) finishes immediately so its stage-time recording stays
    // in sync.
    let justFinishedStage = false;
    let finishedStageNumber: number | null = null;
    let nextPendingFinish = pendingFinish;
    const rawFinishEdge = prevRacingStatus === 1 && currentRacingStatus === 0 && prevStageNumber > 0;

    if (eventId === 20251925) {
      justFinishedStage = rawFinishEdge;
      if (justFinishedStage) finishedStageNumber = prevStageNumber;
      nextPendingFinish = 0;
    } else if (rawFinishEdge) {
      nextPendingFinish = prevStageNumber; // hold for one poll to confirm
    } else if (pendingFinish > 0) {
      if (currentRacingStatus === 1 && currentStageNumber > pendingFinish) {
        // Moved on to a later stage — the pending stage really did finish.
        justFinishedStage = true;
        finishedStageNumber = pendingFinish;
        nextPendingFinish = 0;
      } else if (currentRacingStatus === 1) {
        // Still racing the same stage — it was a blip; drop the pending finish.
        nextPendingFinish = 0;
      } else {
        // Still off stage — confirm the finish.
        justFinishedStage = true;
        finishedStageNumber = pendingFinish;
        nextPendingFinish = 0;
      }
    }

    if (justStartedStage) {
      justStartedStage = await claimAlert(`alert:start:${eventId}:${entryId}:${currentStageNumber}`);
    }
    if (justFinishedStage && finishedStageNumber) {
      justFinishedStage = await claimAlert(`alert:finish:${eventId}:${entryId}:${finishedStageNumber}`);
    }

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
      pendingFinishStage: nextPendingFinish,
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

      // Fallback for events whose live feed never advances stageNumber (Overmountain 2026
      // reports stageNumber=0 for every car). The rc times feed DOES update, so we derive
      // each car's reached stage and freshly-finished stages from it instead.
      let feedReachedStage = 0;
      const feedFinishedStages: number[] = [];
      for (const [n, byCar] of rcStageTimes) {
        if (!byCar.has(sub.carNumber)) continue;
        if (n > feedReachedStage) feedReachedStage = n;
        if (!timesSent.has(n)) feedFinishedStages.push(n);
      }

      if (sub.alerts.stageFinish) {
        for (const n of feedFinishedStages) {
          const claimed = await claimAlert(`alert:finish:${eventId}:${entryId}:${n}`);
          if (!claimed) continue;
          const stageName = rcStageNames.get(n) || (n ? `SS${n}` : "");
          queue.push({ kind: "stageFinish", body: stageFinishMessage(sub, n, stageName) });
        }
      }

      const dueStages: number[] = [];
      if (justFinishedStage && finishedStageNumber) dueStages.push(finishedStageNumber);
      // Re-check every stage the car has reached so far, not just the one it just finished.
      // The results API usually publishes a time a few seconds AFTER the racingStatus flip,
      // so a single-shot attempt on the finish poll would miss it forever (this was why
      // post-stage times/overall alerts never went out). Retrying all reached stages every
      // poll — deduped by timesSent/overallSent/serviceSent — catches the time whenever it
      // lands.
      const maxReachedStage = Math.max(currentStageNumber, prevStageNumber, feedReachedStage, 0);
      for (let n = 1; n <= maxReachedStage; n++) dueStages.push(n);
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
          // Only fire on a stage that immediately precedes a service, when the config
          // lists which stages those are. The reported service is the one following this
          // stage (its index in the list + 1). Unset config keeps the old always-on
          // behavior so unconfigured events don't silently stop sending service alerts.
          const svcIdx = serviceAfterStages ? serviceAfterStages.indexOf(n) : -1;
          const isServiceStage = !serviceAfterStages || serviceAfterStages.length === 0 || svcIdx >= 0;
          if (isServiceStage) {
            const targetService = serviceAfterStages && serviceAfterStages.length ? svcIdx + 1 : undefined;
            const estimates =
              eventId === 20251925
                ? await (async () => {
                    const { simServiceEstimatesFor } = await import("@/lib/sim/engine");
                    return simServiceEstimatesFor(sub.carNumber, n);
                  })()
                : await (async () => {
                    const name = await eventNameForId(eventId);
                    if (!name) return null;
                    return serviceEstimatesForCar(name, sub.carNumber, targetService);
                  })();
            if (estimates && estimates.length) {
              queue.push({ kind: "serviceEstimates", body: serviceEstimatesMessage(sub, estimates) });
              serviceSent.add(n);
            }
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
        const body = incidentIsSafetyEvent
          ? safetyStatusMessage(sub, safetyStatusValue)
          : incidentMessage(
              sub,
              Math.round(stoppedDurationMs / 60000),
              `https://maps.google.com/?q=${live.lat},${live.lng}`
            );
        queue.push({ kind: "incidentDetection", body });
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
      pendingFinishStage: nextPendingFinish,
      lastKnownStageNumber: currentStageNumber,
      lastKnownRacingStatus: currentRacingStatus,
    });
  }
  return results;
}

import { sendSms } from "@/lib/sms";
import { getDevice, pushInbox, type InboxMessage } from "@/lib/store";

/** Write the alert to the in-app inbox, then try SMS. Inbox always lands even if
 * Twilio is blocked (A2P review, etc). */
export async function deliverAlert(opts: {
  deviceId: string;
  phone?: string | null;
  eventId: number;
  entryId?: number;
  carNumber?: string;
  alertType: InboxMessage["alertType"];
  body: string;
  /** Set to false to send SMS only, without also appending to the in-app inbox. Used for
   * the combined batched message so the inbox doesn't show the same content twice (once
   * per individual alert, then again inside the combined batch). */
  inbox?: boolean;
}): Promise<{ inbox: boolean; sms: boolean; smsError?: string }> {
  if (opts.inbox !== false) {
    await pushInbox({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      deviceId: opts.deviceId,
      eventId: opts.eventId,
      entryId: opts.entryId ?? 0,
      carNumber: opts.carNumber ?? "",
      alertType: opts.alertType,
      body: opts.body,
      createdAt: Date.now(),
    });
  }

  if (!opts.phone) {
    console.info("SMS skip: no phone", { eventId: opts.eventId, alertType: opts.alertType, entryId: opts.entryId });
    return { inbox: opts.inbox !== false, sms: false, smsError: "No phone number" };
  }
  const device = await getDevice(opts.deviceId);
  if (device && device.smsEnabled === false) {
    console.info("SMS skip: texts off", { eventId: opts.eventId, alertType: opts.alertType, entryId: opts.entryId });
    return { inbox: opts.inbox !== false, sms: false, smsError: "Texts turned off in Settings" };
  }
  try {
    const msg = await sendSms(opts.phone, opts.body);
    console.info("SMS send", {
      eventId: opts.eventId,
      entryId: opts.entryId,
      alertType: opts.alertType,
      to: opts.phone,
      sid: "sid" in msg ? msg.sid : undefined,
    });
    return { inbox: opts.inbox !== false, sms: true };
  } catch (err) {
    const smsError = err instanceof Error ? err.message : "SMS failed";
    console.error("SMS failed:", {
      eventId: opts.eventId,
      entryId: opts.entryId,
      alertType: opts.alertType,
      to: opts.phone,
      error: smsError,
    });
    return { inbox: opts.inbox !== false, sms: false, smsError };
  }
}

const DEVICE_ID_KEY = "rallysafe-paranoia:deviceId";
const PHONE_KEY = "rallysafe-paranoia:phone";
const SMS_CONSENT_KEY = "rallysafe-paranoia:smsConsented";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getSavedPhone(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(PHONE_KEY) ?? "";
}

export function savePhoneLocally(phone: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PHONE_KEY, phone);
}

/** Whether this browser has already completed the SMS opt-in checkbox once. We only need to
 * ask once per device — re-asking on every Save would be annoying and isn't required once
 * consent has actually been recorded server-side. */
export function hasSmsConsent(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SMS_CONSENT_KEY) === "1";
}

export function saveSmsConsentLocally() {
  if (typeof window === "undefined") return;
  localStorage.setItem(SMS_CONSENT_KEY, "1");
}

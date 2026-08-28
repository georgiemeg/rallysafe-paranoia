import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;

let client: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)");
  }
  if (!client) client = twilio(accountSid, authToken);
  return client;
}

export async function sendSms(to: string, body: string) {
  if (!fromNumber) {
    throw new Error("TWILIO_FROM_NUMBER not configured");
  }
  const c = getClient();
  return c.messages.create({ to, from: fromNumber, body });
}

# RallySafe Paranoia

Track your friends live during a rally stage. Pick an event, check the boxes next to the
drivers/co-drivers you care about, and get a text if their car stops moving for 3+ minutes.

## How it works

- **Frontend** (`app/page.tsx`): pick an event → see every car number/driver/co-driver →
  check the ones you want → save your phone number. Your device gets a random ID stored in
  `localStorage`, so returning to the site (or sharing the link with a friend, who enters
  their own number) remembers your selections without a login.
- **Data source**: the public, unauthenticated RallySafe/RaceControl feed at
  `rc.statusas.com` (`lib/rallysafe.ts`). No API key needed for read-only event/entry data.
- **Storage**: Upstash Redis (free tier) via `@upstash/redis`, holding device profiles,
  subscriptions, and last-known-position state per watched car (`lib/store.ts`).
- **Alerts**: Twilio SMS (`lib/sms.ts`) — a few cents per text, no Mac/iMessage dependency.
- **Polling**: `app/api/cron/poll/route.ts` is a secret-protected endpoint that:
  1. Loads every event with at least one active subscriber.
  2. Fetches live entry positions from RallySafe.
  3. Compares against the last poll; if a watched car hasn't moved (position delta below
     GPS-jitter threshold AND speed ~0) for 3+ minutes, texts every subscriber once per stop.

## Why an external pinger instead of Vercel Cron

Vercel's free (Hobby) plan only allows daily cron schedules. Since we need ~60–90s polling
during a live stage, use a free external scheduler to hit the cron endpoint instead:

- [cron-job.org](https://cron-job.org) (free, supports intervals down to 1 minute)
- Or a tiny GitHub Actions workflow on a `schedule` cron (5-minute minimum) combined with a
  self-looping fetch inside the invoked function for finer granularity within that window.

Point it at:

```
GET https://<your-vercel-domain>/api/cron/poll?secret=<CRON_SECRET>
```

## Environment variables (set in Vercel project settings)

```
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...        # a Twilio phone number capable of sending SMS
CRON_SECRET=<random-string>     # protects the polling endpoint from public abuse
```

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the values above
npm run dev
```

## Deploying

```bash
vercel --prod
```

(or just connect the GitHub repo in the Vercel dashboard for automatic deploys on push)

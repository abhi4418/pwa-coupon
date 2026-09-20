# CouponBot PWA v2 — full desktop flow on the web (desktop app untouched)

`../app.py`, `../bot_core.py`, `../extract_coupons.py`, `../extractor.html` are
**not modified** — everything new lives in this `pwa/` folder, deployable to
**Vercel** as-is.

## What v2 does (desktop parity)

1. **Pick image / take photo → Extract codes** with the same Gemini model +
   system prompt as desktop (`GEMINI_MODEL` + `SYSTEM_PROMPT` in `index.html`),
   via Puter.js. Gallery input + a 📷 Photo button (`capture="environment"`)
   that opens the camera directly on mobile. Each step is logged to the
   activity log, desktop-style.
2. **Claim settings** (phone, UPI, state, batch size, OTP wait) — same
   validation as desktop (`valid_phone` / `valid_upi` ported to
   `server/botCore.mjs`).
3. **Start batch** runs the desktop claim loop on the backend
   (`server/runner.mjs` — port of `bot_core.py`: same XPaths, rejection sniff,
   OTP screenshot, UPI steps, batch limit, stop).
4. **OTP popup** (same role as desktop `OtpPopup`): backend pauses per coupon,
   PWA polls `GET /api/run-state`, shows modal with countdown + page
   screenshot; Submit / Skip / Quit posts to `POST /api/otp`.
5. **Needs review**: failed + skipped land in box 3; edit by hand, then
   **Retry reviewed only** (same box rules as desktop `_on_finished`).
6. **Activity log + progress + DONE (ALL) / SKIPPED / FAILED** mirror desktop.

No-backend fallback: if `/api/*` is unreachable the page still extracts +
copies + manual tracking (old v1 behaviour).

## Layout (all inside `pwa/`)

| Path | Purpose |
|---|---|
| `index.html` | Full PWA UI (Vercel static) |
| `server/botCore.mjs` | Port of `bot_core.py` constants/validators (no desktop import) |
| `server/store.mjs` | Session store: memory locally, Upstash Redis on Vercel |
| `server/runner.mjs` | Playwright claim loop (`playwright-core`, system Chrome / `BROWSER_WS_URL`) |
| `server/localServer.mjs` | Local dev: static + `/api/*` without Vercel |
| `api/run-start.js` | Vercel: validate + create session + start run |
| `api/run-state.js` | Vercel: poll session (logs, OTP gate, screenshot) + **resume** stalled runs |
| `api/health.js` | Vercel: KV self-test + env check (`needsEnv`, `hasBrowserEnv`) for the status hint |
| `api/otp.js` | Vercel: resolve OTP gate (continue/skip/quit + code) |
| `api/run-stop.js` | Vercel: stop run |
| `vercel.json` | Function `maxDuration` (300s needs Pro) |
| `package.json` | Only dep: `playwright-core` |

## Test locally

```bat
cd desktop-app-v2\pwa
npm install
npm run bot-server
```

Open `http://127.0.0.1:8080/index.html`. Needs system Chrome + internet
(claim site, js.puter.com). Extraction works without the backend; claiming
needs the local server running.

## Deploy on Vercel (frontend + functions)

Option A — deploy this folder as the project root:

1. `vercel` → set root to `desktop-app-v2/pwa` (or copy its contents to a repo root).
2. Env vars (Vercel dashboard → Settings → Environment Variables):
   - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (**required on
     Vercel** — functions are stateless; without KV the OTP gate + session
     vanish between polls). Create free at upstash.com → Redis → REST.
   - `BROWSER_WS_URL` (**fallback**) — generic remote CDP such as Browserbase /
     Browserless, e.g. `wss://connect.browserbase.com?...`. Only used when
     `STEEL_API_KEY` is unset.
   - `STEEL_API_KEY` (**recommended**) — Steel cloud browser key from
     `app.steel.dev` → Settings → API Keys. The backend creates a Steel
     session (30 min timeout), drives it over CDP, logs a live-viewer URL
     per run, and releases the session when the batch ends. Without it
     Vercel tries to launch Chromium in-function (needs `@sparticuz/chromium`
     and still hits timeouts).
   - `STEEL_USE_PROXY=true` (**needed if the claim site 403s the cloud
     browser**) — routes the Steel session through Steel's residential
     network. Requires **$10+ paid Steel balance** (free credits don't cover
     proxies/CAPTCHA). Without it, Steel's datacenter IP gets `403
     Forbidden` from the promo site while the desktop app works fine from a
     home (residential) IP. The run detects a block page and says so in the
     log instead of failing every coupon silently.
3. `vercel --prod`. Open the URL in Android Chrome → ⋮ → Add to Home screen.

> **Honest Vercel limit (you chose Vercel-only):** Hobby functions cap at
> ~10–60s; one OTP wait is 60s × 8 coupons ≈ 8 min. A single function cannot
> hold the whole batch. `vercel.json` sets `maxDuration: 300` (needs Pro).
> To survive freezing, every `run-state` poll tries to claim a runner lease
> (`server/store.mjs`) and resumes the run on a fresh instance, reconnecting
> to the SAME Steel browser (`steelSessionId`); heartbeats hold the lease
> while page loads/OTP waits run. Expect up to ~30s stalls on instance hops.
> If polls report `unknown session`, Upstash env vars are missing — the PWA
> now fails loudly instead of stalling. `GET /api/health` reports the exact
> backend state.

## Keep in sync with desktop

- `GEMINI_MODEL` / `SYSTEM_PROMPT` ↔ `../extractor.html`
- `LOCATORS` / `ERROR_RE` / flow ↔ `../bot_core.py` (manual copy — desktop stays frozen)

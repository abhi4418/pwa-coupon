# CouponBot PWA (Step 1 — installable mobile page)

No APK build. This is the "same thing for Android" with the least effort:
an installable web page that does image → codes + tracking on the phone.
Claiming still happens on the promo site (button inside the page).

## What it does

- Pick a coupon image (camera or gallery) — one prompt, on the phone.
- Extract codes with the same Gemini model + system prompt as desktop
  (`extractor.html`), via Puter.js — no API key, one-time free sign-in.
- Editable code list with TODO / DONE / FAILED, saved in `localStorage`.
- Copy next / copy pending, per-code copy.
- "Open claim site" deep-link; mark ✓/✗ as you claim (mirrors desktop box 3).
- Installable: Add to Home screen → standalone icon.

## Test locally

```bat
cd desktop-app-v2\pwa
python -m http.server 8080
```

Open `http://127.0.0.1:8080/index.html` on desktop, or the PC's LAN IP
(e.g. `http://192.168.1.5:8080/index.html`) from Android Chrome on the
same Wi-Fi. Puter.js needs internet.

## Put it on the phone (no Play Store)

Option A — free static host (installable, HTTPS):
1. Upload the `pwa/` folder contents to GitHub Pages / Netlify / Cloudflare Pages.
2. Open the HTTPS URL in Android Chrome → ⋮ → Add to Home screen (or Install app).

Option B — same Wi-Fi only (testing): use the LAN URL above → ⋮ → Add to Home screen.
Service worker + install prompt need `localhost` or HTTPS; plain `http://192.168…`
still works as a page, install prompt may not show — use Option A for the real icon.

## Notes

- Keep `GEMINI_MODEL` / `SYSTEM_PROMPT` in sync with `../extractor.html`.
- Claiming automation (OTP popup flow from `bot_core.py`) is desktop-only.
  This page intentionally only tracks; the phone browser does the claim taps.

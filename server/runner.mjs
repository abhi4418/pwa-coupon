// Long-lived automation loop — port of desktop bot_core.py process_one/run.
// Used by server/localServer.mjs directly. Vercel api/run-start.js reuses
// startRun(); note Vercel hobby functions freeze ~10-60s after response, so
// long OTP batches need Pro maxDuration or a Render/Railway host (see README).
import { CLAIM_URL, LOCATORS, ERROR_RE, MODAL_JS } from "./botCore.mjs";
import { getSession, saveSession, pushLog } from "./store.mjs";
// playwright-core is imported lazily in launchBrowser() so `npm install`
// is only required when actually starting a batch (health/static work w/o it).

const sleep = (a = 0.5, b = 1.0) =>
  new Promise((r) => setTimeout(r, (a + Math.random() * (b - a)) * 1000));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

async function launchBrowser() {
  // Priority: Steel (STEEL_API_KEY) > generic CDP (BROWSER_WS_URL) > local
  // Chrome. Steel runs the browser in its cloud, so Vercel serverless never
  // needs local Chrome. Per Steel docs the WSS shape is
  // wss://connect.steel.dev?apiKey=<key>&sessionId=<id> (sessionId optional).
  const { chromium } = await import("playwright-core");
  const steelKey = process.env.STEEL_API_KEY || "";
  if (steelKey) {
    let steelId = null, viewerUrl = "";
    try {
      const r = await fetch("https://api.steel.dev/v1/sessions", {
        method: "POST",
        headers: { "steel-api-key": steelKey, "Content-Type": "application/json" },
        // 30 min timeout: covers a full batch of OTP waits.
        body: JSON.stringify({ timeout: 1800000 }),
      });
      const j = await r.json().catch(() => ({}));
      steelId = j.id || j.sessionId || null;
      viewerUrl = j.sessionViewerUrl || j.session_viewer_url || "";
    } catch { /* fall back: Steel auto-creates a session on connect */ }
    const ws = steelId
      ? `wss://connect.steel.dev?apiKey=${encodeURIComponent(steelKey)}&sessionId=${steelId}`
      : `wss://connect.steel.dev?apiKey=${encodeURIComponent(steelKey)}`;
    const browser = await chromium.connectOverCDP(ws);
    return { browser, steelId, viewerUrl };
  }
  if (process.env.BROWSER_WS_URL) {
    const browser = await chromium.connectOverCDP(process.env.BROWSER_WS_URL);
    return { browser, steelId: null, viewerUrl: "" };
  }
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  return { browser, steelId: null, viewerUrl: "" };
}

async function releaseSteel(steelId) {
  // Mirror of SDK client.sessions.release(): best-effort, never throws.
  if (!steelId || !process.env.STEEL_API_KEY) return;
  const headers = { "steel-api-key": process.env.STEEL_API_KEY };
  for (const [method, url] of [
    ["POST", `https://api.steel.dev/v1/sessions/${steelId}/release`],
    ["DELETE", `https://api.steel.dev/v1/sessions/${steelId}`],
  ]) {
    try {
      const r = await fetch(url, { method, headers });
      if (r.ok) return;
    } catch { /* try next form */ }
  }
}

async function humanType(el, text) {
  await el.click().catch(() => {});
  await el.fill("").catch(() => {});
  for (const ch of text) {
    await el.pressSequentially(ch, { delay: rnd(50, 140) }).catch(() => el.type(ch).catch(() => {}));
    if (Math.random() < 0.06) await sleep(0.15, 0.35);
  }
}

async function safeType(page, key, text) {
  for (let i = 1; i <= 3; i++) {
    try {
      const el = page.locator(`xpath=${LOCATORS[key]}`).first();
      await el.waitFor({ state: "visible", timeout: 15000 });
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(0.2, 0.4);
      await humanType(el, text);
      const v = (await el.inputValue().catch(() => "")) || "";
      if (v.includes(text)) return true;
    } catch (e) { await sleep(0.8, 1.5); }
  }
  return false;
}

async function safeClick(page, key) {
  for (let i = 1; i <= 3; i++) {
    try {
      const el = page.locator(`xpath=${LOCATORS[key]}`).first();
      await el.waitFor({ state: "visible", timeout: 15000 });
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(0.2, 0.4);
      await el.click({ timeout: 8000 }).catch(async () => el.evaluate((n) => n.click()));
      return true;
    } catch (e) { await sleep(0.8, 1.5); }
  }
  return false;
}

async function otpVisible(page) {
  try {
    const el = page.locator(`xpath=${LOCATORS.otp_next}`).first();
    return await el.isVisible().catch(() => false);
  } catch { return false; }
}

async function visibleError(page) {
  try {
    const alerted = await page.evaluate(() => {
      // native alert can't be read headless-reliably; skip — modal scan below covers it
      return null;
    }).catch(() => null);
    void alerted;
    const data = await page.evaluate(new Function(`return (${MODAL_JS})()`)).catch(() => null);
    if (!data) return null;
    for (const t of data.modals || []) if (t && ERROR_RE.test(t)) return t.split(/\s+/).join(" ").slice(0, 300);
    const m = String(data.body || "").match(
      /already\s+(?:redeem(?:ed)?|claim(?:ed)?|used|registered)|invalid\s+(?:coupon|code|voucher|promo)|(?:coupon|code|voucher)\s+(?:invalid|expired|not\s+valid|not\s+found|already\s+used|already\s+redeemed|already\s+claimed)|redemption\s+failed|coupon\s+has\s+already\s+been\s+used/i
    );
    if (m) {
      const i = Math.max(0, (data.body || "").indexOf(m[0]) - 60);
      return String((data.body || "").slice(i, i + 160)).split(/\s+/).join(" ").slice(0, 300);
    }
  } catch { /* ignore */ }
  return null;
}

async function fillOtp(page, code) {
  code = String(code || "").replace(/\D/g, "");
  if (!code) return false;
  try {
    const boxes = page.locator("input[maxlength='1']");
    const n = await boxes.count().catch(() => 0);
    const vis = [];
    for (let i = 0; i < n; i++) {
      const b = boxes.nth(i);
      if (await b.isVisible().catch(() => false)) vis.push(b);
    }
    if (vis.length >= code.length && vis.length <= 8) {
      for (let i = 0; i < code.length; i++) {
        await vis[i].click().catch(() => {});
        await vis[i].fill(code[i]).catch(() => {});
        await sleep(0.05, 0.12);
      }
      return true;
    }
  } catch { /* try single field */ }
  for (const sel of ["input[inputmode='numeric']", "input[name*='otp' i]", "input[id*='otp' i]", "input[type='tel']"]) {
    try {
      const els = page.locator(sel);
      const n = await els.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const el = els.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        await humanType(el, code);
        const v = (await el.inputValue().catch(() => "")) || "";
        if (v.includes(code)) return true;
      }
    } catch { /* next */ }
  }
  return false;
}

// Wait for the PWA user to resolve the OTP popup (via POST /api/otp).
// Re-reads the session from the store so Vercel/local polling works.
async function waitOtpGate(sessionId, coupon, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const s = await getSession(sessionId);
    if (!s || s.status === "stopped") return { action: "quit", code: "" };
    const g = s.current;
    if (g && g.coupon === coupon && g.otpAction) {
      return { action: g.otpAction, code: g.otpCode || "" };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { action: "skip", code: "" };
}

async function processOne(page, s, coupon) {
  const cfg = s.config;
  const say = (m) => pushLog(s, m);
  say(`Processing coupon ${coupon}`);
  if (!(await safeType(page, "phone", cfg.phone))) return "fail";
  await sleep(0.4, 0.7);
  if (!(await safeType(page, "coupon", coupon))) return "fail";
  await sleep(0.4, 0.7);
  try {
    const sel = page.locator(`xpath=${LOCATORS.state}`).first();
    await sel.waitFor({ state: "visible", timeout: 15000 });
    await sel.selectOption({ label: cfg.state }).catch(() => {});
    await sleep(0.4, 0.7);
  } catch { return "fail"; }
  try {
    const box = page.locator(`xpath=${LOCATORS.terms}`).first();
    await box.waitFor({ timeout: 15000 });
    if (!(await box.isChecked().catch(() => true))) await box.check().catch(() => box.evaluate((n) => n.click()));
  } catch { return "fail"; }
  if (!(await safeClick(page, "submit"))) return "fail";

  // Post-submit: OTP visible vs server rejection (mirrors wait_post_submit).
  const end = Date.now() + 12000;
  let rejection = null;
  while (Date.now() < end) {
    if (await otpVisible(page)) break;
    rejection = await visibleError(page);
    if (rejection) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (rejection && !(await otpVisible(page))) {
    say(`Coupon ${coupon} rejected before OTP (${rejection}) — marking failed`);
    return "fail";
  }

  // OTP gate: screenshot + pause for the PWA popup.
  let shot = "";
  try {
    const buf = await page.screenshot({ timeout: 8000 }).catch(() => null);
    if (buf) shot = "data:image/png;base64," + buf.toString("base64");
  } catch { /* optional */ }
  s.current = { coupon, deadline: Date.now() + cfg.gateTimeout * 1000, screenshot: shot, otpAction: "", otpCode: "" };
  s.status = "awaiting_otp";
  await saveSession(s);
  say(`OTP required for ${coupon} — waiting in PWA popup…`);

  const { action, code } = await waitOtpGate(s.id, coupon, cfg.gateTimeout);
  s = (await getSession(s.id)) || s;
  if (action === "quit" || s.status === "stopped") return "quit";
  if (action === "skip") { say(`Skipped ${coupon}`); return "skip"; }

  if (code) {
    const ok = await fillOtp(page, code);
    say(ok ? `OTP auto-fill succeeded for ${coupon}` : `OTP auto-fill did not stick for ${coupon} — continuing anyway`);
    await sleep(1.0, 1.8);
  } else {
    say(`No OTP code entered for ${coupon} — continuing (solve in page if visible)`);
    await sleep(1.0, 1.8);
  }
  s.current = null;
  s.status = "running";
  await saveSession(s);

  if (!(await safeClick(page, "otp_next"))) return "fail";
  await sleep(0.8, 1.2);
  if (!(await safeClick(page, "upi_option"))) return "fail";
  await sleep(0.4, 0.7);
  if (!(await safeType(page, "upi_id", cfg.upi))) return "fail";
  await sleep(0.4, 0.7);
  try {
    const box = page.locator(`xpath=${LOCATORS.upi_terms}`).first();
    await box.waitFor({ timeout: 15000 });
    if (!(await box.isChecked().catch(() => true))) await box.check().catch(() => box.evaluate((n) => n.click()));
  } catch { return "fail"; }
  if (!(await safeClick(page, "final_submit"))) return "fail";
  await sleep(0.5, 1.0);
  return "done";
}

const liveRuns = new Set();

export async function startRun(sessionId) {
  if (liveRuns.has(sessionId)) return;
  liveRuns.add(sessionId);
  let browser = null, steelId = null;
  try {
    let s = await getSession(sessionId);
    if (!s) return;
    pushLog(s, `Starting: phone=${s.config.phone} upi=${s.config.upi} state=${s.config.state} (${s.todo.length} coupons)`);
    await saveSession(s);

    const h = await launchBrowser();
    browser = h.browser;
    steelId = h.steelId;
    if (h.viewerUrl) pushLog(s, `Steel live view: ${h.viewerUrl}`);
    await saveSession(s);

    // Steel hands us a context with a page already open — reuse it.
    // Local / generic-CDP browsers get a fresh context instead.
    let ctx, page;
    const existing = browser.contexts();
    if (existing.length) {
      ctx = existing[0];
      page = ctx.pages()[0] || (await ctx.newPage());
    } else {
      ctx = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        viewport: { width: 1366, height: 900 },
      });
      page = await ctx.newPage();
    }
    await page.goto(CLAIM_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.locator(`xpath=${LOCATORS.phone}`).first().waitFor({ timeout: 40000 }).catch(() => {});
    let batch = 0;

    while (true) {
      s = (await getSession(sessionId)) || s;
      if (!s || s.status === "stopped") break;
      if (!s.todo.length) break;
      if (batch >= Math.max(1, s.config.batchSize)) {
        pushLog(s, "Batch limit reached — press Start again with fresh details.");
        break;
      }
      const coupon = s.todo[0];
      let outcome = "fail";
      try {
        try { await page.locator(`xpath=${LOCATORS.phone}`).first().waitFor({ timeout: 40000 }); } catch {}
        outcome = await processOne(page, s, coupon);
        s = (await getSession(sessionId)) || s;
      } catch (e) {
        pushLog(s, `Coupon ${coupon} crashed: ${String(e && e.message || e).slice(0, 200)}`);
        outcome = "fail";
      }
      s = (await getSession(sessionId)) || s;
      if (!s) break;
      if (s.status === "stopped") break;
      s.todo.shift();
      s.current = null;
      if (outcome === "done") { s.done.push(coupon); batch++; pushLog(s, `${coupon} done (remaining: ${s.todo.length})`); }
      else if (outcome === "skip") { s.skipped.push(coupon); pushLog(s, `Skipped ${coupon} (remaining: ${s.todo.length})`); }
      else if (outcome === "quit") { s.todo.unshift(coupon); pushLog(s, "Quit requested by user."); break; }
      else { s.failed.push(coupon); pushLog(s, `Failed ${coupon} (remaining: ${s.todo.length})`); }
      if (s.status !== "stopped") s.status = "running";
      await saveSession(s);
      if (s.todo.length && s.status !== "stopped") {
        try {
          await ctx.clearCookies().catch(() => {});
          await page.goto(CLAIM_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
        } catch {}
      }
    }

    s = (await getSession(sessionId)) || s;
    if (s && s.status !== "stopped") {
      s.status = "finished";
      s.current = null;
      s.summary = { done: s.done.length, skipped: s.skipped.length, failed: s.failed.length, remaining: s.todo.length };
      pushLog(s, `Summary: done=${s.done.length} skipped=${s.skipped.length} failed=${s.failed.length} remaining=${s.todo.length}`);
      await saveSession(s);
    }
  } catch (e) {
    try {
      const s = await getSession(sessionId);
      if (s) { s.status = "error"; pushLog(s, "Fatal error: " + String(e && e.message || e).slice(0, 300)); await saveSession(s); }
    } catch {}
  } finally {
    liveRuns.delete(sessionId);
    try { await browser?.close(); } catch {}
    try { await releaseSteel(steelId); } catch {}
  }
}

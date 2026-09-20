// Local dev server: static PWA + same /api/* the PWA calls on Vercel.
// Run: npm run bot-server  (then open http://127.0.0.1:8080/index.html)
// Desktop app is untouched — this only serves pwa/ + automation backend.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newSession, getSession, saveSession, pushLog, storeInfo, kvSelfTest } from "./store.mjs";
import { validPhone, validUpi } from "./botCore.mjs";
// runner (playwright) loaded lazily so health/static work without npm install.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const PORT = Number(process.env.PORT || 8080);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".css": "text/css" };

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  res.end(body);
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}
function pub(s) {
  if (!s) return null;
  const { ...copy } = s;
  return copy;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
      return res.end();
    }
    if (u.pathname === "/api/health") {
      const kv = await kvSelfTest().catch((e) => ({ ok: false, detail: String((e && e.message) || e) }));
      return send(res, kv.ok ? 200 : 500, JSON.stringify({ ok: kv.ok, ...storeInfo(), kv, hasBrowserEnv: Boolean(process.env.STEEL_API_KEY || process.env.BROWSER_WS_URL), isVercel: false, needsEnv: false }));
    }
    if (u.pathname === "/api/run-start" && req.method === "POST") {
      const b = await readJson(req);
      const coupons = [...new Set((b.coupons || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
      if (!validPhone(b.phone || "")) return send(res, 400, JSON.stringify({ error: "Invalid phone: 10 digits starting 6-9." }));
      if (!validUpi(b.upi || "")) return send(res, 400, JSON.stringify({ error: "Invalid UPI ID: name@bank." }));
      if (!coupons.length) return send(res, 400, JSON.stringify({ error: "No coupons." }));
      const s = newSession({ phone: b.phone.trim(), upi: b.upi.trim(), state: (b.state || "DELHI").trim(), batchSize: Math.max(1, Number(b.batchSize) || 8), gateTimeout: Math.max(30, Number(b.gateTimeout) || 60), coupons, tag: b.tag || "fresh" });
      await saveSession(s);
      try {
        const { startRun } = await import("./runner.mjs");
        startRun(s.id).catch(() => {});
      } catch (e) {
        pushLog(s, "Backend needs `npm install` (playwright-core missing).");
        await saveSession(s);
      }
      return send(res, 200, JSON.stringify({ sessionId: s.id }));
    }
    if (u.pathname === "/api/run-state" && req.method === "GET") {
      const s = await getSession(u.searchParams.get("sessionId") || "");
      if (!s) return send(res, 404, JSON.stringify({ error: "unknown session" }));
      return send(res, 200, JSON.stringify(pub(s)));
    }
    if (u.pathname === "/api/otp" && req.method === "POST") {
      const b = await readJson(req);
      const s = await getSession(b.sessionId || "");
      if (!s || !s.current) return send(res, 404, JSON.stringify({ error: "no OTP pending" }));
      const a = String(b.action || "");
      if (!["continue", "skip", "quit"].includes(a)) return send(res, 400, JSON.stringify({ error: "bad action" }));
      s.current.otpAction = a;
      s.current.otpCode = String(b.code || "");
      pushLog(s, a === "continue" ? `OTP submitted for ${s.current.coupon}` : `${a === "quit" ? "Quit" : "Skip"} requested for ${s.current.coupon}`);
      await saveSession(s);
      return send(res, 200, JSON.stringify({ ok: true }));
    }
    if (u.pathname === "/api/run-stop" && req.method === "POST") {
      const b = await readJson(req);
      const s = await getSession(b.sessionId || "");
      if (!s) return send(res, 404, JSON.stringify({ error: "unknown session" }));
      s.status = "stopped";
      if (s.current && !s.current.otpAction) { s.current.otpAction = "quit"; s.current.otpCode = ""; }
      pushLog(s, "Stop requested — winding down…");
      await saveSession(s);
      return send(res, 200, JSON.stringify({ ok: true }));
    }
    if (u.pathname.startsWith("/api/")) return send(res, 404, JSON.stringify({ error: "not found" }));
    // static
    let p = path.normalize(path.join(root, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname)));
    if (!p.startsWith(root)) return send(res, 403, "forbidden", "text/plain");
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
    if (!fs.existsSync(p)) return send(res, 404, "not found", "text/plain");
    res.writeHead(200, { "Content-Type": MIME[path.extname(p).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    send(res, 500, JSON.stringify({ error: String(e && e.message || e) }));
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`CouponBot PWA+bot on http://127.0.0.1:${PORT}/index.html (${storeInfo().backend})`));

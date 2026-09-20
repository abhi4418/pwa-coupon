// Vercel: POST /api/run-start  {phone, upi, state, batchSize, gateTimeout, coupons[], tag}
// NOTE (Vercel-only attempt): serverless functions freeze after the response,
// so hobby (10s) timeouts will cut long OTP batches short. This starts the
// same runner as local dev (best effort); for reliable batches use Pro
// maxDuration (vercel.json: 300s) or host server/localServer.mjs on
// Render/Railway/Fly and point the PWA at it. Desktop app untouched.
import { newSession, saveSession } from "../server/store.mjs";
import { validPhone, validUpi } from "../server/botCore.mjs";
import { startRun } from "../server/runner.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const b = req.body || {};
    const coupons = [...new Set((b.coupons || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
    if (!validPhone(b.phone || "")) return res.status(400).json({ error: "Invalid phone: 10 digits starting 6-9." });
    if (!validUpi(b.upi || "")) return res.status(400).json({ error: "Invalid UPI ID: name@bank." });
    if (!coupons.length) return res.status(400).json({ error: "No coupons." });
    const s = newSession({
      phone: String(b.phone).trim(), upi: String(b.upi).trim(),
      state: String(b.state || "DELHI").trim(),
      batchSize: Math.max(1, Number(b.batchSize) || 8),
      gateTimeout: Math.max(30, Number(b.gateTimeout) || 60),
      coupons, tag: b.tag || "fresh",
    });
    await saveSession(s);
    // Fire-and-forget: continues until maxDuration, then the PWA keeps
    // polling /api/run-state (needs Upstash KV across invocations).
    startRun(s.id).catch(() => {});
    return res.status(200).json({ sessionId: s.id });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}

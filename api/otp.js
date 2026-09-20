import { getSession, saveSession, pushLog } from "../server/store.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const b = req.body || {};
    const s = await getSession(String(b.sessionId || ""));
    if (!s || !s.current) return res.status(404).json({ error: "no OTP pending" });
    const a = String(b.action || "");
    if (!["continue", "skip", "quit"].includes(a)) return res.status(400).json({ error: "bad action" });
    s.current.otpAction = a;
    s.current.otpCode = String(b.code || "");
    pushLog(s, a === "continue" ? `OTP submitted for ${s.current.coupon}` : `${a === "quit" ? "Quit" : "Skip"} requested for ${s.current.coupon}`);
    await saveSession(s);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}

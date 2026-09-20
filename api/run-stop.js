import { getSession, saveSession, pushLog } from "../server/store.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const b = req.body || {};
    const s = await getSession(String(b.sessionId || ""));
    if (!s) return res.status(404).json({ error: "unknown session" });
    s.status = "stopped";
    if (s.current && !s.current.otpAction) { s.current.otpAction = "quit"; s.current.otpCode = ""; }
    pushLog(s, "Stop requested — winding down…");
    await saveSession(s);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}

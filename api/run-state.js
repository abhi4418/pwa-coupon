import { getSession } from "../server/store.mjs";

export default async function handler(req, res) {
  try {
    const id = String((req.query && req.query.sessionId) || "");
    const s = await getSession(id);
    if (!s) return res.status(404).json({ error: "unknown session" });
    // Opportunistic resume: Vercel freezes the run-start instance after its
    // response, so the run stalls until someone drives it. Each poll tries to
    // become the driver (lease = single-flight); the winner reconnects to the
    // same Steel browser and continues. No-op when a runner is already live.
    if (s.status === "running" || s.status === "awaiting_otp") {
      try {
        const { startRun } = await import("../server/runner.mjs");
        startRun(s.id).catch(() => {});
      } catch { /* runner unavailable (no playwright installed); state still returned */ }
    }
    return res.status(200).json(s);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}

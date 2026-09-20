import { getSession } from "../server/store.mjs";

export default async function handler(req, res) {
  try {
    const id = String((req.query && req.query.sessionId) || "");
    const s = await getSession(id);
    if (!s) return res.status(404).json({ error: "unknown session" });
    return res.status(200).json(s);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}

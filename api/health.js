import { storeInfo, kvSelfTest } from "../server/store.mjs";

// GET /api/health — tells the PWA exactly why the backend works or not.
// Fields consumed by index.html checkBackend(): ok, backend, hasBrowserEnv,
// isVercel, needsEnv, kv { ok, detail }.
export default async function handler(req, res) {
  try {
    const info = storeInfo();
    const kv = await kvSelfTest();
    const hasBrowserEnv = Boolean(process.env.STEEL_API_KEY || process.env.BROWSER_WS_URL);
    const isVercel = Boolean(process.env.VERCEL);
    // On Vercel the run stalls without KV persistence AND a cloud browser.
    const needsEnv = isVercel && (!kv.ok || !hasBrowserEnv);
    return res.status(kv.ok && !needsEnv ? 200 : 500).json({
      ok: kv.ok && !needsEnv, backend: info.backend, kv,
      hasBrowserEnv, isVercel, needsEnv,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}

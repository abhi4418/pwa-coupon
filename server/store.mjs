// Session store: in-memory by default (local dev + single-instance).
// Production on Vercel: set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// so OTP gates survive across stateless function invocations.
// No new npm deps — Upstash is plain REST via fetch.
const mem = new Map(); // id -> session object

const RURL = process.env.UPSTASH_REDIS_REST_URL || "";
const RTOK = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const useRedis = Boolean(RURL && RTOK);
const PREFIX = "couponbot:session:";

async function redis(cmd, ...args) {
  const res = await fetch(RURL, {
    method: "POST",
    headers: { Authorization: `Bearer ${RTOK}`, "Content-Type": "application/json" },
    body: JSON.stringify([cmd, ...args]),
  });
  const j = await res.json().catch(() => ({}));
  if (j.error) throw new Error("upstash: " + j.error);
  return j.result;
}

export const storeInfo = () => ({ backend: useRedis ? "upstash-redis" : "memory" });

export async function getSession(id) {
  if (!id) return null;
  if (useRedis) {
    const raw = await redis("GET", PREFIX + id).catch(() => null);
    return raw ? JSON.parse(raw) : null;
  }
  return mem.get(id) || null;
}

export async function saveSession(s) {
  s.updatedAt = Date.now();
  if (useRedis) {
    // 30 min TTL — a batch run never lives longer; refresh on each save.
    await redis("SET", PREFIX + s.id, JSON.stringify(s), "EX", 1800).catch(() => {});
    return s;
  }
  mem.set(s.id, s);
  return s;
}

export async function deleteSession(id) {
  if (useRedis) await redis("DEL", PREFIX + id).catch(() => {});
  mem.delete(id);
}

export function newSession(cfg) {
  const id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).toUpperCase();
  return {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "running", // running | awaiting_otp | finished | stopped | error
    config: {
      phone: cfg.phone, upi: cfg.upi, state: cfg.state || "DELHI",
      batchSize: cfg.batchSize || 8, gateTimeout: cfg.gateTimeout || 60,
      tag: cfg.tag || "fresh",
    },
    todo: [...(cfg.coupons || [])],
    done: [], skipped: [], failed: [],
    current: null, // { coupon, deadline, screenshot (dataURL), otpAction, otpCode }
    logs: [],
    summary: null,
    steelSessionId: "", // Steel browser to reconnect to after instance hops
    viewerUrl: "",      // Steel live-viewer link shown in the PWA
  };
}

export function pushLog(s, msg) {
  const t = new Date().toTimeString().slice(0, 8);
  s.logs.push(`[${t}] ${msg}`);
  if (s.logs.length > 400) s.logs = s.logs.slice(-400);
}

// ---- runner leases: only one live runner per session across instances ----
// Vercel freezes a function after its response, so the run-start instance
// usually dies mid-batch. Each run-state poll tries to claim the lease;
// the winner resumes the run (reconnecting to the same Steel browser).
// Heartbeat refreshes every 10s; TTL 30s bounds stall after a real crash.
const memLeases = new Map(); // id -> { token, exp }
const LEASE_TTL = 30;

export async function claimLease(id) {
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  if (useRedis) {
    const r = await redis("SET", PREFIX + id + ":lease", token, "EX", LEASE_TTL, "NX").catch(() => null);
    return r === "OK" ? token : null;
  }
  const cur = memLeases.get(id);
  if (cur && cur.exp > Date.now()) return null;
  memLeases.set(id, { token, exp: Date.now() + LEASE_TTL * 1000 });
  return token;
}

export async function refreshLease(id, token) {
  if (useRedis) {
    const cur = await redis("GET", PREFIX + id + ":lease").catch(() => null);
    if (cur !== token) return false; // lost to another runner; stop quietly
    await redis("SET", PREFIX + id + ":lease", token, "EX", LEASE_TTL).catch(() => {});
    return true;
  }
  const cur = memLeases.get(id);
  if (!cur || cur.token !== token) return false;
  cur.exp = Date.now() + LEASE_TTL * 1000;
  return true;
}

// Round-trip self-test for /api/health — proves KV writes actually work.
export async function kvSelfTest() {
  if (!useRedis) return { ok: true, detail: "memory (local dev)" };
  try {
    const k = "couponbot:health";
    await redis("SET", k, "1", "EX", 60);
    const v = await redis("GET", k);
    await redis("DEL", k).catch(() => {});
    if (v !== "1") return { ok: false, detail: "write did not read back" };
    return { ok: true, detail: "upstash read+write ok" };
  } catch (e) {
    return { ok: false, detail: String((e && e.message) || e).slice(0, 160) };
  }
}

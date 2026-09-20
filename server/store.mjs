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
  };
}

export function pushLog(s, msg) {
  const t = new Date().toTimeString().slice(0, 8);
  s.logs.push(`[${t}] ${msg}`);
  if (s.logs.length > 400) s.logs = s.logs.slice(-400);
}

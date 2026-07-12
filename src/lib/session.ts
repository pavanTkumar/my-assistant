import { Redis } from '@upstash/redis';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

// ─── Upstash Redis (HTTP-based — safe on Vercel serverless) ──────────────────
// Uses REST endpoint + token. Never use a TCP client (ioredis) from a serverless fn.
//
// Strip surrounding quotes and whitespace that get pasted into dashboard env
// fields by mistake (Vercel stores the value literally, quotes included).
const clean = (v: string | undefined): string =>
  (v || '').trim().replace(/^["']|["']$/g, '').trim();

// Accept whichever env-var names are present. Vercel's Upstash/KV Marketplace
// integration injects UPSTASH_REDIS_REST_* or KV_REST_API_* automatically; our
// local .env.local uses REDIS_URL / REDIS_TOKEN. Any of these work.
const redisUrl = () =>
  clean(process.env.REDIS_URL) ||
  clean(process.env.UPSTASH_REDIS_REST_URL) ||
  clean(process.env.KV_REST_API_URL);
const redisToken = () =>
  clean(process.env.REDIS_TOKEN) ||
  clean(process.env.UPSTASH_REDIS_REST_TOKEN) ||
  clean(process.env.KV_REST_API_TOKEN);

let redis: Redis | null = null;
export const getRedis = (): Redis => {
  if (!redis) {
    redis = new Redis({ url: redisUrl(), token: redisToken() });
  }
  return redis;
};

// ─── Signed cookie (uuid.signature) ──────────────────────────────────────────
export const SESSION_COOKIE = 'myai_uid';
const SECRET = process.env.ENCRYPTION_KEY || 'dev-only-insecure-secret-change-me';

const sign = (value: string): string =>
  createHmac('sha256', SECRET).update(value).digest('base64url');

export const signCookieValue = (uuid: string): string => `${uuid}.${sign(uuid)}`;

// Returns the uuid if the signature is valid, else null.
export const verifyCookieValue = (raw: string | undefined): string | null => {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const uuid = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(uuid);
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? uuid : null;
};

export const newUserId = (): string => randomUUID();

// Cookie options for a ~1 year httpOnly session cookie.
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365, // 1 year
};

// ─── User records (Redis IS the small DB) ────────────────────────────────────
// user:{uuid} hash { name?, first_seen, last_seen, message_count }
// users        set of uuids (enumeration / "who has used it")

export type UserRecord = {
  id: string;
  name?: string;
  first_seen?: string;
  last_seen?: string;
  message_count?: number;
};

const userKey = (id: string) => `user:${id}`;

export async function getUser(id: string): Promise<UserRecord | null> {
  const r = getRedis();
  const data = await r.hgetall<Record<string, string>>(userKey(id));
  if (!data || Object.keys(data).length === 0) return null;
  return {
    id,
    name: data.name || undefined,
    first_seen: data.first_seen,
    last_seen: data.last_seen,
    message_count: data.message_count ? Number(data.message_count) : 0,
  };
}

// Create the record if missing; always bump last_seen. Returns the record.
export async function getOrCreateUser(id: string, nowISO: string): Promise<UserRecord> {
  const r = getRedis();
  const existing = await getUser(id);
  if (existing) {
    await r.hset(userKey(id), { last_seen: nowISO });
    return { ...existing, last_seen: nowISO };
  }
  const record = { first_seen: nowISO, last_seen: nowISO, message_count: 0 };
  await r.hset(userKey(id), record);
  await r.sadd('users', id);
  return { id, ...record };
}

export async function setUserName(id: string, name: string): Promise<void> {
  await getRedis().hset(userKey(id), { name });
}

export async function recordMessage(id: string): Promise<void> {
  await getRedis().hincrby(userKey(id), 'message_count', 1);
}

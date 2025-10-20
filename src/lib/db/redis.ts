/**
 * Redis Client for Conversation State & Caching
 * Uses Upstash Redis (Vercel-compatible)
 */

import { Redis } from '@upstash/redis';

if (!process.env.REDIS_URL || !process.env.REDIS_TOKEN) {
  throw new Error('Missing Redis configuration: REDIS_URL and REDIS_TOKEN required');
}

export const redis = new Redis({
  url: process.env.REDIS_URL,
  token: process.env.REDIS_TOKEN,
});

// ============================================================================
// REDIS KEY PATTERNS
// ============================================================================

export const RedisKeys = {
  // Conversation sessions (TTL: 30 minutes)
  conversation: (sessionId: string) => `conversation:${sessionId}`,
  
  // Availability cache (TTL: 5 minutes)
  availability: (date: string) => `availability:${date}`,
  
  // Slot locks during booking (TTL: 5 minutes)
  slotLock: (datetime: string) => `lock:slot:${datetime}`,
  
  // Rate limiting (TTL: dynamic based on window)
  rateLimit: (identifierHash: string, action: string) => `ratelimit:${action}:${identifierHash}`,
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Set conversation state with TTL
 */
export async function setConversationState(
  sessionId: string,
  state: any,
  ttlSeconds: number = 1800 // 30 minutes
): Promise<void> {
  await redis.setex(RedisKeys.conversation(sessionId), ttlSeconds, JSON.stringify(state));
}

/**
 * Get conversation state
 */
export async function getConversationState(sessionId: string): Promise<any | null> {
  const data = await redis.get(RedisKeys.conversation(sessionId));
  return data ? JSON.parse(data as string) : null;
}

/**
 * Delete conversation state
 */
export async function deleteConversationState(sessionId: string): Promise<void> {
  await redis.del(RedisKeys.conversation(sessionId));
}

/**
 * Lock a time slot temporarily
 */
export async function lockSlot(datetime: string, ttlSeconds: number = 300): Promise<boolean> {
  const key = RedisKeys.slotLock(datetime);
  const result = await redis.set(key, '1', { ex: ttlSeconds, nx: true });
  return result === 'OK';
}

/**
 * Check if slot is locked
 */
export async function isSlotLocked(datetime: string): Promise<boolean> {
  const exists = await redis.exists(RedisKeys.slotLock(datetime));
  return exists === 1;
}

/**
 * Release slot lock
 */
export async function releaseSlotLock(datetime: string): Promise<void> {
  await redis.del(RedisKeys.slotLock(datetime));
}

/**
 * Cache availability data
 */
export async function cacheAvailability(
  date: string,
  slots: any[],
  ttlSeconds: number = 300 // 5 minutes
): Promise<void> {
  await redis.setex(RedisKeys.availability(date), ttlSeconds, JSON.stringify(slots));
}

/**
 * Get cached availability
 */
export async function getCachedAvailability(date: string): Promise<any[] | null> {
  const data = await redis.get(RedisKeys.availability(date));
  return data ? JSON.parse(data as string) : null;
}
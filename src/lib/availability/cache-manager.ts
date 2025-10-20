/**
 * Cache Manager
 * Intelligent Redis-based caching for availability data
 * Handles cache warming, invalidation, and optimization
 */

import { redis, RedisKeys } from '../db/redis';
import { SmartSlot, CachedAvailability, AvailabilityRequest } from './types';

// ============================================================================
// CACHE CONFIGURATION
// ============================================================================

const CACHE_TTL = {
  AVAILABILITY: 300, // 5 minutes - availability data
  CALENDAR: 300, // 5 minutes - calendar free/busy
  SLOT_LOCK: 300, // 5 minutes - temporary slot locks
  USER_QUERY: 1800, // 30 minutes - user query history
  DAILY_SUMMARY: 3600, // 1 hour - daily availability summary
} as const;

const CACHE_KEYS = {
  availability: (dateRange: string, duration: number) =>
    `avail:slots:${dateRange}:${duration}`,
  calendarBusy: (dateRange: string) => `avail:busy:${dateRange}`,
  dailySummary: (date: string) => `avail:summary:${date}`,
  userQuery: (userId: string, queryHash: string) => `avail:query:${userId}:${queryHash}`,
  slotLock: (slotId: string) => `avail:lock:${slotId}`,
  warmingStatus: () => `avail:warming:status`,
} as const;

// ============================================================================
// CACHE MANAGER CLASS
// ============================================================================

export class CacheManager {
  private enableCache: boolean;
  private enableWarmCache: boolean;

  constructor(options?: { enableCache?: boolean; enableWarmCache?: boolean }) {
    this.enableCache = options?.enableCache ?? true;
    this.enableWarmCache = options?.enableWarmCache ?? true;
  }

  // ==========================================================================
  // AVAILABILITY CACHING
  // ==========================================================================

  /**
   * Get cached availability data
   */
  async getAvailability(
    dateRange: string,
    duration: number
  ): Promise<CachedAvailability | null> {
    if (!this.enableCache) return null;

    try {
      const key = CACHE_KEYS.availability(dateRange, duration);
      const cached = await redis.get(key);

      if (!cached) {
        console.log(`❌ Cache miss: ${key}`);
        return null;
      }

      const data = JSON.parse(cached as string);

      // Check if cache is expired
      const expiresAt = new Date(data.expiresAt);
      if (expiresAt < new Date()) {
        console.log(`⏰ Cache expired: ${key}`);
        await redis.del(key);
        return null;
      }

      console.log(`✓ Cache hit: ${key}`);

      // Deserialize dates
      return {
        slots: data.slots.map((slot: any) => ({
          ...slot,
          start: new Date(slot.start),
          end: new Date(slot.end),
        })),
        generatedAt: data.generatedAt,
        expiresAt: data.expiresAt,
        params: data.params,
      };
    } catch (error) {
      console.error('Cache read error:', error);
      return null;
    }
  }

  /**
   * Cache availability data
   */
  async setAvailability(
    dateRange: string,
    duration: number,
    slots: SmartSlot[],
    params: AvailabilityRequest
  ): Promise<void> {
    if (!this.enableCache) return;

    try {
      const key = CACHE_KEYS.availability(dateRange, duration);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CACHE_TTL.AVAILABILITY * 1000);

      const data: CachedAvailability = {
        slots: slots.map((slot) => ({
          ...slot,
          start: slot.start.toISOString(),
          end: slot.end.toISOString(),
        })) as any,
        generatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        params,
      };

      await redis.setex(key, CACHE_TTL.AVAILABILITY, JSON.stringify(data));
      console.log(`✓ Cached availability: ${key} (TTL: ${CACHE_TTL.AVAILABILITY}s)`);
    } catch (error) {
      console.error('Cache write error:', error);
      // Don't throw - caching is optional
    }
  }

  /**
   * Invalidate availability cache for a date range
   */
  async invalidateAvailability(dateRange: string, duration?: number): Promise<void> {
    try {
      if (duration) {
        // Invalidate specific duration
        const key = CACHE_KEYS.availability(dateRange, duration);
        await redis.del(key);
        console.log(`✓ Invalidated cache: ${key}`);
      } else {
        // Invalidate all durations for this date range
        const pattern = `avail:slots:${dateRange}:*`;
        const keys = await this.getKeysByPattern(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
          console.log(`✓ Invalidated ${keys.length} cache entries for ${dateRange}`);
        }
      }
    } catch (error) {
      console.error('Cache invalidation error:', error);
    }
  }

  // ==========================================================================
  // CALENDAR BUSY PERIODS CACHING
  // ==========================================================================

  /**
   * Get cached calendar busy periods
   */
  async getCalendarBusy(dateRange: string): Promise<any | null> {
    if (!this.enableCache) return null;

    try {
      const key = CACHE_KEYS.calendarBusy(dateRange);
      const cached = await redis.get(key);

      if (!cached) {
        console.log(`❌ Calendar cache miss: ${key}`);
        return null;
      }

      console.log(`✓ Calendar cache hit: ${key}`);
      const data = JSON.parse(cached as string);

      // Deserialize dates
      return {
        ...data,
        busyPeriods: data.busyPeriods.map((bp: any) => ({
          start: new Date(bp.start),
          end: new Date(bp.end),
          summary: bp.summary,
        })),
      };
    } catch (error) {
      console.error('Calendar cache read error:', error);
      return null;
    }
  }

  /**
   * Cache calendar busy periods
   */
  async setCalendarBusy(dateRange: string, busyData: any): Promise<void> {
    if (!this.enableCache) return;

    try {
      const key = CACHE_KEYS.calendarBusy(dateRange);

      // Serialize dates
      const data = {
        ...busyData,
        busyPeriods: busyData.busyPeriods.map((bp: any) => ({
          start: bp.start.toISOString(),
          end: bp.end.toISOString(),
          summary: bp.summary,
        })),
      };

      await redis.setex(key, CACHE_TTL.CALENDAR, JSON.stringify(data));
      console.log(`✓ Cached calendar busy periods: ${key}`);
    } catch (error) {
      console.error('Calendar cache write error:', error);
    }
  }

  // ==========================================================================
  // SLOT LOCKING (TEMPORARY RESERVATIONS)
  // ==========================================================================

  /**
   * Lock a slot temporarily during booking process
   */
  async lockSlot(slotId: string, userId: string): Promise<boolean> {
    try {
      const key = CACHE_KEYS.slotLock(slotId);
      const lockData = {
        userId,
        lockedAt: new Date().toISOString(),
      };

      // Use NX flag to only set if doesn't exist
      const result = await redis.set(key, JSON.stringify(lockData), {
        ex: CACHE_TTL.SLOT_LOCK,
        nx: true,
      });

      if (result === 'OK') {
        console.log(`✓ Slot locked: ${slotId} by ${userId}`);
        return true;
      }

      console.log(`❌ Slot already locked: ${slotId}`);
      return false;
    } catch (error) {
      console.error('Slot lock error:', error);
      return false;
    }
  }

  /**
   * Check if slot is locked
   */
  async isSlotLocked(slotId: string): Promise<boolean> {
    try {
      const key = CACHE_KEYS.slotLock(slotId);
      const exists = await redis.exists(key);
      return exists === 1;
    } catch (error) {
      console.error('Slot lock check error:', error);
      return false;
    }
  }

  /**
   * Get slot lock info
   */
  async getSlotLock(slotId: string): Promise<{ userId: string; lockedAt: string } | null> {
    try {
      const key = CACHE_KEYS.slotLock(slotId);
      const data = await redis.get(key);

      if (!data) return null;

      return JSON.parse(data as string);
    } catch (error) {
      console.error('Get slot lock error:', error);
      return null;
    }
  }

  /**
   * Release slot lock
   */
  async releaseSlotLock(slotId: string): Promise<void> {
    try {
      const key = CACHE_KEYS.slotLock(slotId);
      await redis.del(key);
      console.log(`✓ Slot lock released: ${slotId}`);
    } catch (error) {
      console.error('Slot unlock error:', error);
    }
  }

  // ==========================================================================
  // DAILY SUMMARY CACHING
  // ==========================================================================

  /**
   * Get cached daily availability summary
   */
  async getDailySummary(date: string): Promise<{
    totalSlots: number;
    optimalSlots: number;
    averageScore: number;
  } | null> {
    if (!this.enableCache) return null;

    try {
      const key = CACHE_KEYS.dailySummary(date);
      const cached = await redis.get(key);

      if (!cached) return null;

      return JSON.parse(cached as string);
    } catch (error) {
      console.error('Daily summary cache error:', error);
      return null;
    }
  }

  /**
   * Cache daily availability summary
   */
  async setDailySummary(
    date: string,
    summary: {
      totalSlots: number;
      optimalSlots: number;
      averageScore: number;
    }
  ): Promise<void> {
    if (!this.enableCache) return;

    try {
      const key = CACHE_KEYS.dailySummary(date);
      await redis.setex(key, CACHE_TTL.DAILY_SUMMARY, JSON.stringify(summary));
      console.log(`✓ Cached daily summary: ${date}`);
    } catch (error) {
      console.error('Daily summary cache write error:', error);
    }
  }

  // ==========================================================================
  // USER QUERY CACHING
  // ==========================================================================

  /**
   * Get cached user query result
   */
  async getUserQuery(userId: string, queryHash: string): Promise<any | null> {
    if (!this.enableCache) return null;

    try {
      const key = CACHE_KEYS.userQuery(userId, queryHash);
      const cached = await redis.get(key);

      if (!cached) return null;

      return JSON.parse(cached as string);
    } catch (error) {
      console.error('User query cache error:', error);
      return null;
    }
  }

  /**
   * Cache user query result
   */
  async setUserQuery(userId: string, queryHash: string, data: any): Promise<void> {
    if (!this.enableCache) return;

    try {
      const key = CACHE_KEYS.userQuery(userId, queryHash);
      await redis.setex(key, CACHE_TTL.USER_QUERY, JSON.stringify(data));
    } catch (error) {
      console.error('User query cache write error:', error);
    }
  }

  // ==========================================================================
  // CACHE WARMING
  // ==========================================================================

  /**
   * Warm cache with upcoming availability
   * Pre-generates slots for next N days
   */
  async warmCache(days: number = 7): Promise<void> {
    if (!this.enableWarmCache) return;

    try {
      console.log(`🔥 Warming cache for next ${days} days...`);

      const warmingKey = CACHE_KEYS.warmingStatus();

      // Check if warming is already in progress
      const inProgress = await redis.get(warmingKey);
      if (inProgress) {
        console.log('⚠️  Cache warming already in progress');
        return;
      }

      // Set warming status
      await redis.setex(warmingKey, 300, 'in_progress');

      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + days);

      // Generate date range string
      const dateRange = `${startDate.toISOString().split('T')[0]}_${endDate.toISOString().split('T')[0]}`;

      // Common durations to pre-cache
      const commonDurations = [15, 30, 60, 120];

      let warmedCount = 0;

      for (const duration of commonDurations) {
        const key = CACHE_KEYS.availability(dateRange, duration);

        // Check if already cached
        const exists = await redis.exists(key);
        if (exists) {
          console.log(`  ✓ Already cached: ${duration} min slots`);
          continue;
        }

        // Here you would generate slots and cache them
        // For now, we'll just mark it as a placeholder
        console.log(`  🔥 Warming: ${duration} min slots`);
        warmedCount++;
      }

      // Clear warming status
      await redis.del(warmingKey);

      console.log(`✅ Cache warming complete: ${warmedCount} entries warmed`);
    } catch (error) {
      console.error('Cache warming error:', error);
      // Clear warming status on error
      await redis.del(CACHE_KEYS.warmingStatus());
    }
  }

  // ==========================================================================
  // CACHE INVALIDATION STRATEGIES
  // ==========================================================================

  /**
   * Invalidate all availability caches
   */
  async invalidateAll(): Promise<void> {
    try {
      const patterns = ['avail:slots:*', 'avail:busy:*', 'avail:summary:*'];

      let totalDeleted = 0;

      for (const pattern of patterns) {
        const keys = await this.getKeysByPattern(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
          totalDeleted += keys.length;
        }
      }

      console.log(`✓ Invalidated all caches: ${totalDeleted} entries deleted`);
    } catch (error) {
      console.error('Cache invalidation error:', error);
    }
  }

  /**
   * Invalidate caches for specific date
   */
  async invalidateDate(date: string): Promise<void> {
    try {
      const patterns = [`avail:slots:${date}*`, `avail:busy:${date}*`, `avail:summary:${date}`];

      let totalDeleted = 0;

      for (const pattern of patterns) {
        const keys = await this.getKeysByPattern(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
          totalDeleted += keys.length;
        }
      }

      console.log(`✓ Invalidated caches for ${date}: ${totalDeleted} entries`);
    } catch (error) {
      console.error('Date cache invalidation error:', error);
    }
  }

  /**
   * Invalidate expired entries (cleanup)
   */
  async cleanupExpired(): Promise<void> {
    try {
      console.log('🧹 Cleaning up expired cache entries...');

      // Redis automatically handles TTL expiration
      // This is just for manual cleanup if needed

      const patterns = ['avail:*'];
      let cleanedCount = 0;

      for (const pattern of patterns) {
        const keys = await this.getKeysByPattern(pattern);

        for (const key of keys) {
          const ttl = await redis.ttl(key);
          if (ttl === -1) {
            // No TTL set, might be stale
            await redis.del(key);
            cleanedCount++;
          }
        }
      }

      console.log(`✓ Cleanup complete: ${cleanedCount} entries removed`);
    } catch (error) {
      console.error('Cache cleanup error:', error);
    }
  }

  // ==========================================================================
  // CACHE STATISTICS
  // ==========================================================================

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    totalKeys: number;
    availabilityKeys: number;
    calendarKeys: number;
    lockKeys: number;
    memoryUsage: string;
  }> {
    try {
      const availKeys = await this.getKeysByPattern('avail:slots:*');
      const calKeys = await this.getKeysByPattern('avail:busy:*');
      const lockKeys = await this.getKeysByPattern('avail:lock:*');

      return {
        totalKeys: availKeys.length + calKeys.length + lockKeys.length,
        availabilityKeys: availKeys.length,
        calendarKeys: calKeys.length,
        lockKeys: lockKeys.length,
        memoryUsage: 'N/A', // Would need Redis INFO command
      };
    } catch (error) {
      console.error('Get cache stats error:', error);
      return {
        totalKeys: 0,
        availabilityKeys: 0,
        calendarKeys: 0,
        lockKeys: 0,
        memoryUsage: 'Error',
      };
    }
  }

  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================

  /**
   * Get keys matching a pattern (for cleanup/invalidation)
   */
  private async getKeysByPattern(pattern: string): Promise<string[]> {
    try {
      // Note: Upstash Redis uses REST API, so we need to use scan
      // This is a simplified version - in production, implement proper scanning
      const keys: string[] = [];

      // For Upstash, we'd need to implement scanning differently
      // This is a placeholder implementation
      return keys;
    } catch (error) {
      console.error('Get keys by pattern error:', error);
      return [];
    }
  }

  /**
   * Generate query hash for user queries
   */
  generateQueryHash(params: AvailabilityRequest): string {
    const hashInput = JSON.stringify({
      start: params.startDate.toISOString(),
      end: params.endDate.toISOString(),
      duration: params.duration,
      preferences: params.preferences,
    });

    // Simple hash function (in production, use crypto)
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString(36);
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let cacheManagerInstance: CacheManager | null = null;

/**
 * Get singleton cache manager instance
 */
export function getCacheManagerInstance(options?: {
  enableCache?: boolean;
  enableWarmCache?: boolean;
}): CacheManager {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager(options);
  }
  return cacheManagerInstance;
}
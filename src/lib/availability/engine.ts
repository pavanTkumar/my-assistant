/**
 * Availability Engine
 * Main orchestrator for the Smart Availability System
 * Coordinates Calendar, Generator, Ranker, and Cache
 */

import { CalendarClient, getCalendarClientInstance } from './calendar-client';
import { SlotGenerator, getSlotGeneratorInstance } from './slot-generator';
import { SlotRanker, getSlotRankerInstance } from './slot-ranker';
import { CacheManager, getCacheManagerInstance } from './cache-manager';
import {
  AvailabilityRequest,
  AvailabilityResponse,
  SmartSlot,
  AvailabilityError,
  AvailabilitySuggestion,
} from './types';
import { validateDateRange, validateDuration, detectTimezone } from './calendar-utils';
import { CALENDAR_CONFIG } from '../calendar/config';

// ============================================================================
// AVAILABILITY ENGINE CLASS
// ============================================================================

export class AvailabilityEngine {
  private calendarClient: CalendarClient;
  private slotGenerator: SlotGenerator;
  private slotRanker: SlotRanker;
  private cacheManager: CacheManager;

  constructor(options?: {
    enableCache?: boolean;
    enableWarmCache?: boolean;
  }) {
    this.calendarClient = getCalendarClientInstance({
      enableCache: options?.enableCache ?? true,
    });
    this.slotGenerator = getSlotGeneratorInstance();
    this.slotRanker = getSlotRankerInstance();
    this.cacheManager = getCacheManagerInstance({
      enableCache: options?.enableCache ?? true,
      enableWarmCache: options?.enableWarmCache ?? true,
    });
  }

  // ==========================================================================
  // MAIN AVAILABILITY QUERY
  // ==========================================================================

  /**
   * Get available time slots
   * Main entry point for availability queries
   */
  async getAvailability(request: AvailabilityRequest): Promise<AvailabilityResponse> {
    const startTime = Date.now();

    try {
      // ==================================================================
      // STEP 1: VALIDATION
      // ==================================================================
      console.log('🔍 Step 1: Validating request...');

      const validationErrors = this.validateRequest(request);
      if (validationErrors.length > 0) {
        throw this.createError(
          'INVALID_DATE_RANGE',
          validationErrors.join('; '),
          validationErrors
        );
      }

      // Detect timezone if not provided
      const timezone = request.preferences?.timezone || CALENDAR_CONFIG.timezone;

      // ==================================================================
      // STEP 2: CHECK CACHE
      // ==================================================================
      console.log('💾 Step 2: Checking cache...');

      const dateRange = this.generateDateRangeKey(request.startDate, request.endDate);
      const cachedResult = await this.cacheManager.getAvailability(
        dateRange,
        request.duration
      );

      if (cachedResult) {
        console.log('✅ Cache hit! Returning cached data.');

        return {
          success: true,
          slots: cachedResult.slots,
          metadata: {
            totalSlotsFound: cachedResult.slots.length,
            dateRange: {
              start: request.startDate.toISOString(),
              end: request.endDate.toISOString(),
            },
            queriedAt: cachedResult.generatedAt,
            cacheHit: true,
            generationTime: Date.now() - startTime,
          },
          timezone,
          workingHours: CALENDAR_CONFIG.workingHours,
        };
      }

      console.log('❌ Cache miss. Generating fresh data...');

      // ==================================================================
      // STEP 3: FETCH CALENDAR DATA
      // ==================================================================
      console.log('📅 Step 3: Fetching calendar busy periods...');

      const freeBusy = await this.calendarClient.getFreeBusy(
        request.startDate,
        request.endDate,
        timezone
      );

      console.log(`   Found ${freeBusy.busyPeriods.length} busy periods`);

      // ==================================================================
      // STEP 4: GENERATE SLOTS
      // ==================================================================
      console.log('⚙️  Step 4: Generating available slots...');

      const rawSlots = this.slotGenerator.generateSlots(
        request.startDate,
        request.endDate,
        request.duration,
        freeBusy.busyPeriods,
        timezone
      );

      console.log(`   Generated ${rawSlots.length} raw slots`);

      // Check if no slots found
      if (rawSlots.length === 0) {
        console.log('⚠️  No slots available');

        const suggestions = await this.generateSuggestions(request, freeBusy.busyPeriods);

        return {
          success: false,
          slots: [],
          metadata: {
            totalSlotsFound: 0,
            dateRange: {
              start: request.startDate.toISOString(),
              end: request.endDate.toISOString(),
            },
            queriedAt: new Date().toISOString(),
            cacheHit: false,
            generationTime: Date.now() - startTime,
          },
          timezone,
          workingHours: CALENDAR_CONFIG.workingHours,
          suggestions,
        };
      }

      // ==================================================================
      // STEP 5: RANK SLOTS
      // ==================================================================
      console.log('📊 Step 5: Ranking slots by quality...');

      const rankedSlots = this.slotRanker.rankSlots(
        rawSlots,
        freeBusy.busyPeriods,
        request.duration,
        timezone,
        request.preferences
      );

      console.log(`   Ranked ${rankedSlots.length} slots`);
      console.log(
        `   Average quality score: ${this.slotRanker.getAverageQualityScore(rankedSlots)}`
      );

      // Apply slot limit if specified
      const limitedSlots = request.maxSlotsPerDay
        ? this.applyDailyLimit(rankedSlots, request.maxSlotsPerDay)
        : rankedSlots;

      // ==================================================================
      // STEP 6: CACHE RESULTS
      // ==================================================================
      console.log('💾 Step 6: Caching results...');

      await this.cacheManager.setAvailability(dateRange, request.duration, limitedSlots, request);

      // ==================================================================
      // STEP 7: RETURN RESPONSE
      // ==================================================================
      console.log('✅ Step 7: Returning response');

      const response: AvailabilityResponse = {
        success: true,
        slots: limitedSlots,
        metadata: {
          totalSlotsFound: limitedSlots.length,
          dateRange: {
            start: request.startDate.toISOString(),
            end: request.endDate.toISOString(),
          },
          queriedAt: new Date().toISOString(),
          cacheHit: false,
          generationTime: Date.now() - startTime,
        },
        timezone,
        workingHours: CALENDAR_CONFIG.workingHours,
      };

      console.log(`🎉 Complete! Generated in ${response.metadata.generationTime}ms`);

      return response;
    } catch (error: any) {
      console.error('❌ Availability engine error:', error);

      // Return error response
      return {
        success: false,
        slots: [],
        metadata: {
          totalSlotsFound: 0,
          dateRange: {
            start: request.startDate.toISOString(),
            end: request.endDate.toISOString(),
          },
          queriedAt: new Date().toISOString(),
          cacheHit: false,
          generationTime: Date.now() - startTime,
        },
        timezone: request.preferences?.timezone || CALENDAR_CONFIG.timezone,
        workingHours: CALENDAR_CONFIG.workingHours,
        suggestions: [
          {
            type: 'future_date',
            message: 'An error occurred. Please try a different date range.',
          },
        ],
      };
    }
  }

  // ==========================================================================
  // QUICK QUERIES
  // ==========================================================================

  /**
   * Get availability for a specific date
   */
  async getAvailabilityForDate(
    date: Date,
    duration: number,
    timezone?: string
  ): Promise<SmartSlot[]> {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const response = await this.getAvailability({
      startDate,
      endDate,
      duration,
      preferences: { timezone },
    });

    return response.slots;
  }

  /**
   * Get next N available slots
   */
  async getNextAvailableSlots(
    duration: number,
    count: number = 5,
    timezone?: string
  ): Promise<SmartSlot[]> {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14); // Look 2 weeks ahead

    const response = await this.getAvailability({
      startDate,
      endDate,
      duration,
      preferences: { timezone },
      maxSlotsPerDay: count,
    });

    return response.slots.slice(0, count);
  }

  /**
   * Check if a specific slot is available
   */
  async isSlotAvailable(
    start: Date,
    end: Date,
    timezone?: string
  ): Promise<{ available: boolean; reason?: string }> {
    try {
      const tz = timezone || CALENDAR_CONFIG.timezone;

      // Check if slot is locked
      const slotId = `slot_${start.getTime()}_${end.getTime() - start.getTime()}`;
      const isLocked = await this.cacheManager.isSlotLocked(slotId);

      if (isLocked) {
        return {
          available: false,
          reason: 'Slot is temporarily reserved by another user',
        };
      }

      // Check calendar
      const available = await this.calendarClient.isSlotAvailable(start, end, tz);

      return {
        available,
        reason: available ? undefined : 'Slot conflicts with existing booking',
      };
    } catch (error) {
      console.error('Error checking slot availability:', error);
      return {
        available: false,
        reason: 'Error checking availability',
      };
    }
  }

  /**
   * Reserve a slot temporarily (5 minutes)
   */
  async reserveSlot(slot: SmartSlot, userId: string): Promise<boolean> {
    try {
      const locked = await this.cacheManager.lockSlot(slot.id, userId);

      if (locked) {
        console.log(`✓ Slot reserved: ${slot.id} for user ${userId}`);

        // Invalidate availability cache for this date
        const dateRange = this.generateDateRangeKey(slot.start, slot.end);
        await this.cacheManager.invalidateAvailability(dateRange);
      }

      return locked;
    } catch (error) {
      console.error('Error reserving slot:', error);
      return false;
    }
  }

  /**
   * Release a reserved slot
   */
  async releaseSlot(slotId: string): Promise<void> {
    try {
      await this.cacheManager.releaseSlotLock(slotId);
      console.log(`✓ Slot reservation released: ${slotId}`);
    } catch (error) {
      console.error('Error releasing slot:', error);
    }
  }

  // ==========================================================================
  // CACHE MANAGEMENT
  // ==========================================================================

  /**
   * Warm cache for upcoming dates
   */
  async warmCache(days: number = 7): Promise<void> {
    console.log(`🔥 Warming cache for next ${days} days...`);
    await this.cacheManager.warmCache(days);
  }

  /**
   * Invalidate all availability caches
   */
  async invalidateAllCaches(): Promise<void> {
    console.log('🧹 Invalidating all caches...');
    await this.cacheManager.invalidateAll();
  }

  /**
   * Invalidate cache for specific date
   */
  async invalidateDateCache(date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];
    console.log(`🧹 Invalidating cache for ${dateStr}...`);
    await this.cacheManager.invalidateDate(dateStr);
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<any> {
    return await this.cacheManager.getStats();
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  /**
   * Validate availability request
   */
  private validateRequest(request: AvailabilityRequest): string[] {
    const errors: string[] = [];

    // Validate date range
    const timezone = request.preferences?.timezone || CALENDAR_CONFIG.timezone;
    const dateValidation = validateDateRange(request.startDate, request.endDate, timezone);

    if (!dateValidation.valid) {
      errors.push(dateValidation.error!);
    }

    // Validate duration
    const durationValidation = validateDuration(request.duration);
    if (!durationValidation.valid) {
      errors.push(durationValidation.error!);
    }

    // Check if date range is too far in the future
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + CALENDAR_CONFIG.meeting.maxBookingWindow);

    if (request.startDate > maxDate) {
      errors.push(
        `Cannot book more than ${CALENDAR_CONFIG.meeting.maxBookingWindow} days in advance`
      );
    }

    return errors;
  }

  // ==========================================================================
  // SUGGESTIONS
  // ==========================================================================

  /**
   * Generate suggestions when no slots available
   */
  private async generateSuggestions(
    request: AvailabilityRequest,
    busyPeriods: any[]
  ): Promise<AvailabilitySuggestion[]> {
    const suggestions: AvailabilitySuggestion[] = [];

    // Suggestion 1: Try different duration
    if (request.duration > 30) {
      suggestions.push({
        type: 'alternative_duration',
        message: `No ${request.duration}-minute slots available. Try a shorter duration (30 minutes)?`,
        action: {
          type: 'retry_with_duration',
          data: { duration: 30 },
        },
      });
    }

    // Suggestion 2: Try next week
    const nextWeekStart = new Date(request.endDate);
    nextWeekStart.setDate(nextWeekStart.getDate() + 1);

    const nextWeekEnd = new Date(nextWeekStart);
    nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);

    suggestions.push({
      type: 'alternative_time',
      message: 'No availability in selected range. Try next week?',
      action: {
        type: 'retry_with_dates',
        data: {
          startDate: nextWeekStart.toISOString(),
          endDate: nextWeekEnd.toISOString(),
        },
      },
    });

    // Suggestion 3: Join waitlist
    suggestions.push({
      type: 'waitlist',
      message: 'Join the waitlist to be notified when slots open up.',
      action: {
        type: 'join_waitlist',
        data: {
          duration: request.duration,
          dateRange: {
            start: request.startDate.toISOString(),
            end: request.endDate.toISOString(),
          },
        },
      },
    });

    return suggestions;
  }

  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================

  /**
   * Generate cache key for date range
   */
  private generateDateRangeKey(startDate: Date, endDate: Date): string {
    const start = startDate.toISOString().split('T')[0];
    const end = endDate.toISOString().split('T')[0];
    return `${start}_${end}`;
  }

  /**
   * Apply daily slot limit
   */
  private applyDailyLimit(slots: SmartSlot[], maxPerDay: number): SmartSlot[] {
    const slotsByDay = new Map<string, SmartSlot[]>();

    // Group by day
    for (const slot of slots) {
      const dateKey = slot.start.toISOString().split('T')[0];
      if (!slotsByDay.has(dateKey)) {
        slotsByDay.set(dateKey, []);
      }
      slotsByDay.get(dateKey)!.push(slot);
    }

    // Limit each day
    const limitedSlots: SmartSlot[] = [];
    for (const [date, daySlots] of slotsByDay) {
      limitedSlots.push(...daySlots.slice(0, maxPerDay));
    }

    // Sort by quality score
    limitedSlots.sort((a, b) => b.qualityScore - a.qualityScore);

    return limitedSlots;
  }

  /**
   * Create availability error
   */
  private createError(
    code: string,
    message: string,
    details?: any
  ): AvailabilityError {
    return {
      code: code as any,
      message,
      details,
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let availabilityEngineInstance: AvailabilityEngine | null = null;

/**
 * Get singleton availability engine instance
 */
export function getAvailabilityEngineInstance(options?: {
  enableCache?: boolean;
  enableWarmCache?: boolean;
}): AvailabilityEngine {
  if (!availabilityEngineInstance) {
    availabilityEngineInstance = new AvailabilityEngine(options);
  }
  return availabilityEngineInstance;
}
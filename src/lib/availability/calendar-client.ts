/**
 * Google Calendar Client Wrapper
 * Handles calendar queries, timezone conversion, and caching
 */

import { calendar_v3 } from 'googleapis';
import { getCalendarClient, getCalendarId } from '../calendar/service-account';
import { CALENDAR_CONFIG } from '../calendar/config';
import { redis, RedisKeys } from '../db/redis';
import { BusyPeriod, FreeBusyResponse } from './types';

// ============================================================================
// CALENDAR CLIENT CLASS
// ============================================================================

export class CalendarClient {
  private calendarApi: calendar_v3.Calendar;
  private calendarId: string;
  private enableCache: boolean;
  private cacheTTL: number; // seconds

  constructor(options?: { enableCache?: boolean; cacheTTL?: number }) {
    this.calendarApi = getCalendarClient();
    this.calendarId = getCalendarId();
    this.enableCache = options?.enableCache ?? true;
    this.cacheTTL = options?.cacheTTL ?? 300; // 5 minutes default
  }

  // ==========================================================================
  // FREE/BUSY QUERY
  // ==========================================================================

  /**
   * Get free/busy information for a date range
   * Includes intelligent caching
   */
  async getFreeBusy(
    startDate: Date,
    endDate: Date,
    timezone: string = CALENDAR_CONFIG.timezone
  ): Promise<FreeBusyResponse> {
    // Generate cache key
    const cacheKey = this.generateFreeBusyCacheKey(startDate, endDate);

    // Try cache first
    if (this.enableCache) {
      const cached = await this.getCachedFreeBusy(cacheKey);
      if (cached) {
        console.log(`✓ Calendar cache hit: ${cacheKey}`);
        return cached;
      }
    }

    console.log(`⚡ Fetching from Google Calendar API...`);

    try {
      // Query Google Calendar API
      const response = await this.calendarApi.freebusy.query({
        requestBody: {
          timeMin: startDate.toISOString(),
          timeMax: endDate.toISOString(),
          timeZone: timezone,
          items: [{ id: this.calendarId }],
        },
      });

      // Parse busy periods
      const busySlots = response.data.calendars?.[this.calendarId]?.busy || [];
      const busyPeriods: BusyPeriod[] = busySlots.map((slot) => ({
        start: new Date(slot.start || ''),
        end: new Date(slot.end || ''),
      }));

      const result: FreeBusyResponse = {
        timezone,
        busyPeriods,
        queriedRange: {
          start: startDate,
          end: endDate,
        },
      };

      // Cache the result
      if (this.enableCache) {
        await this.cacheFreeBusy(cacheKey, result);
      }

      console.log(`✓ Found ${busyPeriods.length} busy periods`);
      return result;
    } catch (error: any) {
      console.error('❌ Calendar API error:', error.message);
      throw new CalendarAPIError(
        'Failed to fetch calendar data',
        error.code || 'CALENDAR_ERROR',
        error
      );
    }
  }

  /**
   * Check if a specific slot is available
   */
  async isSlotAvailable(
    start: Date,
    end: Date,
    timezone: string = CALENDAR_CONFIG.timezone
  ): Promise<boolean> {
    // Fetch busy periods for the day
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(start);
    dayEnd.setHours(23, 59, 59, 999);

    const { busyPeriods } = await this.getFreeBusy(dayStart, dayEnd, timezone);

    // Check if slot overlaps with any busy period
    return !this.hasConflict(start, end, busyPeriods);
  }

  /**
   * Get all events for a date range (detailed info)
   */
  async getEvents(
    startDate: Date,
    endDate: Date,
    timezone: string = CALENDAR_CONFIG.timezone
  ): Promise<calendar_v3.Schema$Event[]> {
    try {
      const response = await this.calendarApi.events.list({
        calendarId: this.calendarId,
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        timeZone: timezone,
        singleEvents: true,
        orderBy: 'startTime',
      });

      return response.data.items || [];
    } catch (error: any) {
      console.error('❌ Error fetching events:', error.message);
      throw new CalendarAPIError('Failed to fetch events', 'EVENTS_ERROR', error);
    }
  }

  // ==========================================================================
  // CONFLICT DETECTION
  // ==========================================================================

  /**
   * Check if a time slot conflicts with busy periods
   */
  private hasConflict(
    slotStart: Date,
    slotEnd: Date,
    busyPeriods: BusyPeriod[]
  ): boolean {
    return busyPeriods.some((busy) => {
      const busyStart = busy.start.getTime();
      const busyEnd = busy.end.getTime();
      const slotStartTime = slotStart.getTime();
      const slotEndTime = slotEnd.getTime();

      // Check if there's any overlap
      return (
        (slotStartTime >= busyStart && slotStartTime < busyEnd) ||
        (slotEndTime > busyStart && slotEndTime <= busyEnd) ||
        (slotStartTime <= busyStart && slotEndTime >= busyEnd)
      );
    });
  }

  /**
   * Find conflicts for a slot with buffer consideration
   */
  findConflictsWithBuffer(
    slotStart: Date,
    slotEnd: Date,
    busyPeriods: BusyPeriod[],
    bufferMinutes: number = CALENDAR_CONFIG.meeting.bufferTime
  ): { hasConflict: boolean; conflicts: BusyPeriod[]; needsBuffer: boolean } {
    const bufferMs = bufferMinutes * 60 * 1000;
    const conflicts: BusyPeriod[] = [];
    let needsBuffer = false;

    for (const busy of busyPeriods) {
      const busyStart = busy.start.getTime();
      const busyEnd = busy.end.getTime();
      const slotStartTime = slotStart.getTime();
      const slotEndTime = slotEnd.getTime();

      // Direct overlap
      if (
        (slotStartTime >= busyStart && slotStartTime < busyEnd) ||
        (slotEndTime > busyStart && slotEndTime <= busyEnd) ||
        (slotStartTime <= busyStart && slotEndTime >= busyEnd)
      ) {
        conflicts.push(busy);
      }
      // Buffer conflict (too close)
      else if (
        (slotStartTime - bufferMs < busyEnd && slotStartTime >= busyEnd) ||
        (slotEndTime + bufferMs > busyStart && slotEndTime <= busyStart)
      ) {
        needsBuffer = true;
      }
    }

    return {
      hasConflict: conflicts.length > 0,
      conflicts,
      needsBuffer,
    };
  }

  // ==========================================================================
  // CACHING
  // ==========================================================================

  /**
   * Generate cache key for free/busy query
   */
  private generateFreeBusyCacheKey(startDate: Date, endDate: Date): string {
    const start = startDate.toISOString().split('T')[0];
    const end = endDate.toISOString().split('T')[0];
    return `calendar:freebusy:${start}:${end}`;
  }

  /**
   * Get cached free/busy data
   */
  private async getCachedFreeBusy(key: string): Promise<FreeBusyResponse | null> {
    try {
      const cached = await redis.get(key);
      if (!cached) return null;

      const data = JSON.parse(cached as string);

      // Parse dates back from ISO strings
      return {
        timezone: data.timezone,
        busyPeriods: data.busyPeriods.map((bp: any) => ({
          start: new Date(bp.start),
          end: new Date(bp.end),
          summary: bp.summary,
          isAllDay: bp.isAllDay,
        })),
        queriedRange: {
          start: new Date(data.queriedRange.start),
          end: new Date(data.queriedRange.end),
        },
      };
    } catch (error) {
      console.error('Cache read error:', error);
      return null;
    }
  }

  /**
   * Cache free/busy data
   */
  private async cacheFreeBusy(key: string, data: FreeBusyResponse): Promise<void> {
    try {
      // Convert dates to ISO strings for JSON storage
      const serializable = {
        timezone: data.timezone,
        busyPeriods: data.busyPeriods.map((bp) => ({
          start: bp.start.toISOString(),
          end: bp.end.toISOString(),
          summary: bp.summary,
          isAllDay: bp.isAllDay,
        })),
        queriedRange: {
          start: data.queriedRange.start.toISOString(),
          end: data.queriedRange.end.toISOString(),
        },
      };

      await redis.setex(key, this.cacheTTL, JSON.stringify(serializable));
      console.log(`✓ Cached calendar data: ${key}`);
    } catch (error) {
      console.error('Cache write error:', error);
      // Don't throw - caching is optional
    }
  }

  /**
   * Invalidate cache for a date range
   */
  async invalidateCache(startDate: Date, endDate: Date): Promise<void> {
    const key = this.generateFreeBusyCacheKey(startDate, endDate);
    try {
      await redis.del(key);
      console.log(`✓ Invalidated cache: ${key}`);
    } catch (error) {
      console.error('Cache invalidation error:', error);
    }
  }

  // ==========================================================================
  // TIMEZONE UTILITIES
  // ==========================================================================

  /**
   * Convert time between timezones
   */
  convertTimezone(date: Date, fromTz: string, toTz: string): Date {
    // Use Intl API for timezone conversion
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: toTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const values: any = {};

    parts.forEach((part) => {
      if (part.type !== 'literal') {
        values[part.type] = parseInt(part.value);
      }
    });

    return new Date(
      values.year,
      values.month - 1,
      values.day,
      values.hour,
      values.minute,
      values.second
    );
  }

  /**
   * Get timezone offset in minutes
   */
  getTimezoneOffset(timezone: string, date: Date = new Date()): number {
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    return (tzDate.getTime() - utcDate.getTime()) / (1000 * 60);
  }

  /**
   * Format time in specific timezone
   */
  formatInTimezone(
    date: Date,
    timezone: string,
    options: Intl.DateTimeFormatOptions = {}
  ): string {
    return new Intl.DateTimeFormat('en-US', {
      ...options,
      timeZone: timezone,
    }).format(date);
  }
}

// ============================================================================
// CUSTOM ERRORS
// ============================================================================

export class CalendarAPIError extends Error {
  public code: string;
  public originalError?: any;

  constructor(message: string, code: string, originalError?: any) {
    super(message);
    this.name = 'CalendarAPIError';
    this.code = code;
    this.originalError = originalError;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let calendarClientInstance: CalendarClient | null = null;

/**
 * Get singleton calendar client instance
 */
export function getCalendarClientInstance(
  options?: { enableCache?: boolean; cacheTTL?: number }
): CalendarClient {
  if (!calendarClientInstance) {
    calendarClientInstance = new CalendarClient(options);
  }
  return calendarClientInstance;
}
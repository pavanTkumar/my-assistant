/**
 * Calendar utility functions
 * Date manipulation, timezone handling, and formatting
 */

import { CALENDAR_CONFIG } from '../calendar/config';

// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Get start of day in specific timezone
 */
export function getStartOfDay(date: Date, timezone: string): Date {
  const dateStr = date.toLocaleString('en-US', { timeZone: timezone });
  const localDate = new Date(dateStr);
  localDate.setHours(0, 0, 0, 0);
  return localDate;
}

/**
 * Get end of day in specific timezone
 */
export function getEndOfDay(date: Date, timezone: string): Date {
  const dateStr = date.toLocaleString('en-US', { timeZone: timezone });
  const localDate = new Date(dateStr);
  localDate.setHours(23, 59, 59, 999);
  return localDate;
}

/**
 * Check if date is today
 */
export function isToday(date: Date, timezone: string): boolean {
  const now = new Date();
  const nowInTz = getStartOfDay(now, timezone);
  const dateInTz = getStartOfDay(date, timezone);
  return nowInTz.getTime() === dateInTz.getTime();
}

/**
 * Check if date is in the past
 */
export function isPast(date: Date, timezone: string): boolean {
  const now = new Date();
  const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const dateInTz = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return dateInTz < nowInTz;
}

/**
 * Add days to date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Add minutes to date
 */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/**
 * Get difference in minutes between two dates
 */
export function getMinutesDifference(date1: Date, date2: Date): number {
  return Math.abs(date1.getTime() - date2.getTime()) / (1000 * 60);
}

/**
 * Check if date is weekend
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

/**
 * Check if date is a blackout day
 */
export function isBlackoutDay(date: Date): boolean {
  // Check weekends
  if (CALENDAR_CONFIG.blackout.weekdays.includes(date.getDay())) {
    return true;
  }

  // Check specific dates
  const dateString = date.toISOString().split('T')[0];
  return CALENDAR_CONFIG.blackout.dates.includes(dateString);
}

// ============================================================================
// TIME FORMATTING
// ============================================================================

/**
 * Format time (e.g., "2:00 PM")
 */
export function formatTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(date);
}

/**
 * Format date (e.g., "Monday, Oct 21")
 */
export function formatDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  }).format(date);
}

/**
 * Format full datetime (e.g., "Monday, Oct 21 at 2:00 PM")
 */
export function formatDateTime(date: Date, timezone: string): string {
  return `${formatDate(date, timezone)} at ${formatTime(date, timezone)}`;
}

/**
 * Format date range (e.g., "2:00 PM - 3:00 PM")
 */
export function formatTimeRange(start: Date, end: Date, timezone: string): string {
  return `${formatTime(start, timezone)} - ${formatTime(end, timezone)}`;
}

// ============================================================================
// TIMEZONE DETECTION
// ============================================================================

/**
 * Detect user timezone from request headers or IP
 * Fallback to default timezone
 */
export function detectTimezone(headers?: Headers): string {
  // Try to get from headers
  if (headers) {
    const tzHeader = headers.get('X-Timezone') || headers.get('timezone');
    if (tzHeader && isValidTimezone(tzHeader)) {
      return tzHeader;
    }
  }

  // Try to get from Intl API (works client-side)
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && isValidTimezone(detected)) {
      return detected;
    }
  } catch (e) {
    // Ignore errors
  }

  // Fallback to config default
  return CALENDAR_CONFIG.timezone;
}

/**
 * Validate timezone string
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get timezone abbreviation (e.g., "IST", "EST")
 */
export function getTimezoneAbbreviation(timezone: string, date: Date = new Date()): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'short',
  }).format(date);

  const match = formatted.match(/([A-Z]{2,5})$/);
  return match ? match[1] : timezone;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate date range for availability query
 */
export function validateDateRange(
  startDate: Date,
  endDate: Date,
  timezone: string
): { valid: boolean; error?: string } {
  // Check if start is before end
  if (startDate >= endDate) {
    return { valid: false, error: 'Start date must be before end date' };
  }

  // Check if start is in the past
  if (isPast(startDate, timezone)) {
    return { valid: false, error: 'Start date cannot be in the past' };
  }

  // Check if range is too large
  const daysDiff = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysDiff > CALENDAR_CONFIG.meeting.maxBookingWindow) {
    return {
      valid: false,
      error: `Date range cannot exceed ${CALENDAR_CONFIG.meeting.maxBookingWindow} days`,
    };
  }

  return { valid: true };
}

/**
 * Validate meeting duration
 */
export function validateDuration(duration: number): { valid: boolean; error?: string } {
  if (duration <= 0) {
    return { valid: false, error: 'Duration must be positive' };
  }

  if (duration < 15) {
    return { valid: false, error: 'Minimum duration is 15 minutes' };
  }

  if (duration > 480) {
    // 8 hours
    return { valid: false, error: 'Maximum duration is 8 hours' };
  }

  // Check if duration is multiple of 15
  if (duration % 15 !== 0) {
    return { valid: false, error: 'Duration must be a multiple of 15 minutes' };
  }

  return { valid: true };
}
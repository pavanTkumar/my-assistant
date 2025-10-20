/**
 * Calendar Configuration
 * Centralized settings for booking rules and calendar behavior
 */

export const CALENDAR_CONFIG = {
    // Timezone
    timezone: process.env.CALENDAR_TIMEZONE || 'Asia/Kolkata',
  
    // Working hours (24-hour format)
    workingHours: {
      start: parseInt(process.env.CALENDAR_WORKING_HOURS_START || '9'),
      end: parseInt(process.env.CALENDAR_WORKING_HOURS_END || '18'),
    },
  
    // Meeting settings
    meeting: {
      defaultDuration: parseInt(process.env.CALENDAR_DEFAULT_DURATION || '30'), // minutes
      bufferTime: parseInt(process.env.CALENDAR_BUFFER_MINUTES || '15'), // minutes
      minAdvanceNotice: parseInt(process.env.CALENDAR_ADVANCE_NOTICE_HOURS || '2'), // hours
      maxBookingWindow: parseInt(process.env.CALENDAR_MAX_BOOKING_DAYS || '30'), // days
    },
  
    // Booking limits
    limits: {
      maxBookingsPerUserPerWeek: parseInt(process.env.MAX_BOOKINGS_PER_USER_PER_WEEK || '2'),
    },
  
    // Blackout days
    blackout: {
        // Days of week to exclude (0 = Sunday, 6 = Saturday)
        weekdays: [0, 6] as number[], // Fixed: as number[] instead of const array
        
        // Specific dates to exclude (format: YYYY-MM-DD)
        dates: [
          // Indian Public Holidays 2025
          '2025-01-26', // Republic Day
          '2025-03-14', // Holi
          '2025-04-10', // Eid ul-Fitr (tentative)
          '2025-08-15', // Independence Day
          '2025-10-02', // Gandhi Jayanti
          '2025-10-24', // Dussehra
          '2025-11-12', // Diwali
          '2025-12-25', // Christmas
        ] as string[], // Fixed: as string[] instead of const array
      },
  
    // Slot generation settings
    slots: {
      intervalMinutes: 30, // Generate slots every 30 minutes
      maxSlotsPerDay: 16, // Maximum slots to show per day
    },
  } as const;
  
  /**
   * Check if a date is a blackout day
   */
/**
 * Check if a date is a blackout day
 */
export function isBlackoutDay(date: Date): boolean {
    const dayOfWeek = date.getDay();
    
    // Check if weekend
    if ((CALENDAR_CONFIG.blackout.weekdays as number[]).includes(dayOfWeek)) {
      return true;
    }
  
    // Check if specific holiday
    const dateString = date.toISOString().split('T')[0];
    if ((CALENDAR_CONFIG.blackout.dates as string[]).includes(dateString)) {
      return true;
    }
  
    return false;
  }
  
  /**
   * Check if a time is within working hours
   */
  export function isWithinWorkingHours(hour: number): boolean {
    return (
      hour >= CALENDAR_CONFIG.workingHours.start &&
      hour < CALENDAR_CONFIG.workingHours.end
    );
  }
  
  /**
   * Get minimum bookable date (considering advance notice)
   */
  export function getMinimumBookableDate(): Date {
    const now = new Date();
    const advanceNoticeMs = CALENDAR_CONFIG.meeting.minAdvanceNotice * 60 * 60 * 1000;
    return new Date(now.getTime() + advanceNoticeMs);
  }
  
  /**
   * Get maximum bookable date
   */
  export function getMaximumBookableDate(): Date {
    const now = new Date();
    const maxBookingMs = CALENDAR_CONFIG.meeting.maxBookingWindow * 24 * 60 * 60 * 1000;
    return new Date(now.getTime() + maxBookingMs);
  }
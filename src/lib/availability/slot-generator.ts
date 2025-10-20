/**
 * Slot Generator
 * Creates time slots from calendar availability with intelligent filtering
 */

import { CALENDAR_CONFIG, isBlackoutDay, isWithinWorkingHours } from '../calendar/config';
import { RawSlot, BusyPeriod, SlotGenerationConfig, TimeOfDay } from './types';
import {
  addMinutes,
  isWeekend,
  isPast,
  getStartOfDay,
  getEndOfDay,
} from './calendar-utils';

// ============================================================================
// SLOT GENERATOR CLASS
// ============================================================================

export class SlotGenerator {
  private config: SlotGenerationConfig;

  constructor(customConfig?: Partial<SlotGenerationConfig>) {
    this.config = {
      workingHours: CALENDAR_CONFIG.workingHours,
      minAdvanceNotice: CALENDAR_CONFIG.meeting.minAdvanceNotice * 60, // Convert hours to minutes
      maxAdvanceBooking: CALENDAR_CONFIG.meeting.maxBookingWindow,
      bufferTime: CALENDAR_CONFIG.meeting.bufferTime,
      slotInterval: CALENDAR_CONFIG.slots.intervalMinutes,
      maxSlotsPerDay: CALENDAR_CONFIG.slots.maxSlotsPerDay,
      blackoutDates: CALENDAR_CONFIG.blackout.dates as string[],
      blackoutWeekdays: CALENDAR_CONFIG.blackout.weekdays as number[],
      timezone: CALENDAR_CONFIG.timezone,
      ...customConfig,
    };
  }

  // ==========================================================================
  // MAIN SLOT GENERATION
  // ==========================================================================

  /**
   * Generate available slots for a date range
   * @param startDate - Start of date range
   * @param endDate - End of date range
   * @param duration - Requested meeting duration (minutes)
   * @param busyPeriods - Busy times from calendar
   * @param timezone - Target timezone
   */
  generateSlots(
    startDate: Date,
    endDate: Date,
    duration: number,
    busyPeriods: BusyPeriod[],
    timezone: string = this.config.timezone
  ): RawSlot[] {
    const slots: RawSlot[] = [];
    let currentDate = new Date(startDate);

    // Iterate through each day in the range
    while (currentDate <= endDate) {
      const dailySlots = this.generateSlotsForDay(
        currentDate,
        duration,
        busyPeriods,
        timezone
      );

      // Apply daily slot limit
      const limitedSlots = dailySlots.slice(0, this.config.maxSlotsPerDay);
      slots.push(...limitedSlots);

      // Move to next day
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return slots;
  }

  /**
   * Generate slots for a single day
   */
  private generateSlotsForDay(
    date: Date,
    duration: number,
    busyPeriods: BusyPeriod[],
    timezone: string
  ): RawSlot[] {
    // Skip if blackout day
    if (this.isBlackoutDay(date)) {
      return [];
    }

    // Get working hours for the day
    const dayStart = this.getDayWorkingStart(date, timezone);
    const dayEnd = this.getDayWorkingEnd(date, timezone);

    // Generate candidate slots
    const candidateSlots = this.generateCandidateSlots(dayStart, dayEnd, duration);

    // Filter out busy slots
    const availableSlots = this.filterBusySlots(
      candidateSlots,
      busyPeriods,
      this.config.bufferTime
    );

    // Filter by advance notice
    const validSlots = availableSlots.filter((slot) =>
      this.meetsAdvanceNotice(slot.start, timezone)
    );

    return validSlots;
  }

  // ==========================================================================
  // CANDIDATE SLOT GENERATION
  // ==========================================================================

  /**
   * Generate all possible slots within working hours
   */
  private generateCandidateSlots(
    dayStart: Date,
    dayEnd: Date,
    duration: number
  ): RawSlot[] {
    const slots: RawSlot[] = [];
    let currentTime = new Date(dayStart);

    while (currentTime < dayEnd) {
      const slotEnd = addMinutes(currentTime, duration);

      // Check if slot fits within working hours
      if (slotEnd <= dayEnd) {
        slots.push({
          start: new Date(currentTime),
          end: slotEnd,
          duration,
        });
      }

      // Move to next interval
      currentTime = addMinutes(currentTime, this.config.slotInterval);
    }

    return slots;
  }

  // ==========================================================================
  // FILTERING
  // ==========================================================================

  /**
   * Filter out slots that conflict with busy periods
   */
  private filterBusySlots(
    slots: RawSlot[],
    busyPeriods: BusyPeriod[],
    bufferMinutes: number
  ): RawSlot[] {
    return slots.filter((slot) => {
      // Check for conflicts with busy periods
      for (const busy of busyPeriods) {
        if (this.hasConflict(slot, busy, bufferMinutes)) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Check if slot conflicts with busy period (including buffer)
   */
  private hasConflict(
    slot: RawSlot,
    busy: BusyPeriod,
    bufferMinutes: number
  ): boolean {
    const bufferMs = bufferMinutes * 60 * 1000;

    // Slot times with buffer
    const slotStart = slot.start.getTime() - bufferMs;
    const slotEnd = slot.end.getTime() + bufferMs;

    // Busy period times
    const busyStart = busy.start.getTime();
    const busyEnd = busy.end.getTime();

    // Check for any overlap
    return slotStart < busyEnd && slotEnd > busyStart;
  }

  // ==========================================================================
  // VALIDATION & FILTERS
  // ==========================================================================

  /**
   * Check if date is a blackout day
   */
  private isBlackoutDay(date: Date): boolean {
    // Check weekday blackouts
    const dayOfWeek = date.getDay();
    if (this.config.blackoutWeekdays.includes(dayOfWeek)) {
      return true;
    }

    // Check specific date blackouts
    const dateString = date.toISOString().split('T')[0];
    return this.config.blackoutDates.includes(dateString);
  }

  /**
   * Check if slot meets minimum advance notice requirement
   */
  private meetsAdvanceNotice(slotStart: Date, timezone: string): boolean {
    const now = new Date();
    const minBookableTime = addMinutes(now, this.config.minAdvanceNotice);

    // Convert both to same timezone for comparison
    const slotStartInTz = new Date(
      slotStart.toLocaleString('en-US', { timeZone: timezone })
    );
    const minTimeInTz = new Date(
      minBookableTime.toLocaleString('en-US', { timeZone: timezone })
    );

    return slotStartInTz >= minTimeInTz;
  }

  /**
   * Check if date is within max booking window
   */
  private isWithinBookingWindow(date: Date, timezone: string): boolean {
    const now = new Date();
    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + this.config.maxAdvanceBooking);

    const dateInTz = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    const maxDateInTz = new Date(maxDate.toLocaleString('en-US', { timeZone: timezone }));

    return dateInTz <= maxDateInTz;
  }

  // ==========================================================================
  // WORKING HOURS HELPERS
  // ==========================================================================

  /**
   * Get start of working hours for a day
   */
  private getDayWorkingStart(date: Date, timezone: string): Date {
    const dayStart = getStartOfDay(date, timezone);
    dayStart.setHours(this.config.workingHours.start, 0, 0, 0);
    return dayStart;
  }

  /**
   * Get end of working hours for a day
   */
  private getDayWorkingEnd(date: Date, timezone: string): Date {
    const dayEnd = getStartOfDay(date, timezone);
    dayEnd.setHours(this.config.workingHours.end, 0, 0, 0);
    return dayEnd;
  }

  // ==========================================================================
  // SLOT ANALYSIS
  // ==========================================================================

  /**
   * Determine time of day for a slot
   */
  getTimeOfDay(slot: RawSlot): TimeOfDay {
    const hour = slot.start.getHours();

    if (hour >= 5 && hour < 8) return 'early_morning';
    if (hour >= 8 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  /**
   * Check if slot has buffer before
   */
  hasBufferBefore(
    slot: RawSlot,
    busyPeriods: BusyPeriod[],
    bufferMinutes: number = this.config.bufferTime
  ): boolean {
    const bufferStart = addMinutes(slot.start, -bufferMinutes);

    for (const busy of busyPeriods) {
      if (busy.end > bufferStart && busy.end <= slot.start) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if slot has buffer after
   */
  hasBufferAfter(
    slot: RawSlot,
    busyPeriods: BusyPeriod[],
    bufferMinutes: number = this.config.bufferTime
  ): boolean {
    const bufferEnd = addMinutes(slot.end, bufferMinutes);

    for (const busy of busyPeriods) {
      if (busy.start >= slot.end && busy.start < bufferEnd) {
        return false;
      }
    }
    return true;
  }

  /**
   * Count available slots for a date
   */
  countSlotsForDate(
    date: Date,
    duration: number,
    busyPeriods: BusyPeriod[],
    timezone: string = this.config.timezone
  ): number {
    const slots = this.generateSlotsForDay(date, duration, busyPeriods, timezone);
    return slots.length;
  }

  /**
   * Find earliest available slot
   */
  findEarliestSlot(
    startDate: Date,
    endDate: Date,
    duration: number,
    busyPeriods: BusyPeriod[],
    timezone: string = this.config.timezone
  ): RawSlot | null {
    const slots = this.generateSlots(startDate, endDate, duration, busyPeriods, timezone);
    return slots.length > 0 ? slots[0] : null;
  }

  /**
   * Find next available day with slots
   */
  findNextAvailableDay(
    startDate: Date,
    duration: number,
    busyPeriods: BusyPeriod[],
    timezone: string = this.config.timezone
  ): Date | null {
    let currentDate = new Date(startDate);
    const maxDate = new Date(startDate);
    maxDate.setDate(maxDate.getDate() + this.config.maxAdvanceBooking);

    while (currentDate <= maxDate) {
      const count = this.countSlotsForDate(currentDate, duration, busyPeriods, timezone);
      if (count > 0) {
        return currentDate;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return null;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let slotGeneratorInstance: SlotGenerator | null = null;

/**
 * Get singleton slot generator instance
 */
export function getSlotGeneratorInstance(
  customConfig?: Partial<SlotGenerationConfig>
): SlotGenerator {
  if (!slotGeneratorInstance || customConfig) {
    slotGeneratorInstance = new SlotGenerator(customConfig);
  }
  return slotGeneratorInstance;
}
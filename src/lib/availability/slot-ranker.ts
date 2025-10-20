/**
 * Slot Ranker
 * Intelligent quality scoring algorithm for time slots
 * Scores slots from 0-100 based on multiple factors
 */

import { RawSlot, SmartSlot, TimeOfDay, RankingConfig, SlotQualityFactors } from './types';
import { BusyPeriod } from './types';
import { formatTime, formatDate, formatTimeRange } from './calendar-utils';
import { CALENDAR_CONFIG } from '../calendar/config';

// ============================================================================
// DEFAULT RANKING CONFIGURATION
// ============================================================================

const DEFAULT_RANKING_CONFIG: RankingConfig = {
  weights: {
    timeOfDay: 30,      // Afternoon slots preferred
    buffer: 20,         // Having buffer time is important
    weekday: 15,        // Mid-week preferred
    urgency: 15,        // Sooner for urgent, later for flexible
    durationMatch: 10,  // Exact duration match
    preference: 10,     // User preferences
  },
  preferredTimeOfDay: ['afternoon', 'morning'],
  preferredWeekdays: [2, 3, 4], // Tuesday, Wednesday, Thursday
  optimalScoreThreshold: 80, // Top 20% = optimal
};

// ============================================================================
// SLOT RANKER CLASS
// ============================================================================

export class SlotRanker {
  private config: RankingConfig;

  constructor(customConfig?: Partial<RankingConfig>) {
    this.config = {
      ...DEFAULT_RANKING_CONFIG,
      ...customConfig,
      weights: {
        ...DEFAULT_RANKING_CONFIG.weights,
        ...customConfig?.weights,
      },
    };

    // Validate weights sum to 100
    this.validateWeights();
  }

  // ==========================================================================
  // MAIN RANKING FUNCTION
  // ==========================================================================

  /**
   * Rank and enhance slots with quality scoring
   * Converts RawSlot[] to SmartSlot[]
   */
  rankSlots(
    rawSlots: RawSlot[],
    busyPeriods: BusyPeriod[],
    requestedDuration: number,
    timezone: string,
    preferences?: {
      timeOfDay?: TimeOfDay[];
      urgency?: 'urgent' | 'flexible';
    }
  ): SmartSlot[] {
    // Calculate quality factors for each slot
    const slotsWithScores = rawSlots.map((slot) => {
      const factors = this.calculateQualityFactors(
        slot,
        busyPeriods,
        requestedDuration,
        preferences
      );

      const qualityScore = this.calculateTotalScore(factors);

      return {
        slot,
        factors,
        qualityScore,
      };
    });

    // Sort by quality score (highest first)
    slotsWithScores.sort((a, b) => b.qualityScore - a.qualityScore);

    // Determine optimal threshold
    const optimalThreshold = this.config.optimalScoreThreshold;

    // Convert to SmartSlot format
    const smartSlots: SmartSlot[] = slotsWithScores.map((item, index) => {
      const { slot, factors, qualityScore } = item;

      const timeOfDay = this.getTimeOfDay(slot);
      const hasBufferBefore = this.hasBufferBefore(slot, busyPeriods);
      const hasBufferAfter = this.hasBufferAfter(slot, busyPeriods);

      // Generate reasons and warnings
      const reasons = this.generateReasons(factors, slot, timeOfDay);
      const warnings = this.generateWarnings(factors, slot, hasBufferBefore, hasBufferAfter);

      return {
        id: this.generateSlotId(slot),
        start: slot.start,
        end: slot.end,
        duration: slot.duration,

        // Formatting
        startTimeFormatted: formatTime(slot.start, timezone),
        endTimeFormatted: formatTime(slot.end, timezone),
        dateFormatted: formatDate(slot.start, timezone),

        // Quality
        qualityScore: Math.round(qualityScore),
        isOptimal: qualityScore >= optimalThreshold,

        // Context
        reasons,
        warnings,

        // Metadata
        metadata: {
          hasBufferBefore,
          hasBufferAfter,
          timeOfDay,
          isPreferred: this.isPreferredSlot(slot, preferences),
          conflicts: [],
        },

        // Timezone
        timezone,
        timezoneOffset: this.getTimezoneOffset(timezone, slot.start),
      };
    });

    return smartSlots;
  }

  // ==========================================================================
  // QUALITY FACTOR CALCULATION
  // ==========================================================================

  /**
   * Calculate all quality factors for a slot
   */
  private calculateQualityFactors(
    slot: RawSlot,
    busyPeriods: BusyPeriod[],
    requestedDuration: number,
    preferences?: {
      timeOfDay?: TimeOfDay[];
      urgency?: 'urgent' | 'flexible';
    }
  ): SlotQualityFactors {
    return {
      timeOfDayScore: this.scoreTimeOfDay(slot),
      bufferScore: this.scoreBuffer(slot, busyPeriods),
      weekdayScore: this.scoreWeekday(slot),
      urgencyScore: this.scoreUrgency(slot, preferences?.urgency),
      durationMatchScore: this.scoreDurationMatch(slot.duration, requestedDuration),
      preferenceScore: this.scorePreference(slot, preferences),
    };
  }

  /**
   * Calculate total weighted score (0-100)
   */
  private calculateTotalScore(factors: SlotQualityFactors): number {
    const weights = this.config.weights;

    const totalScore =
      (factors.timeOfDayScore * weights.timeOfDay +
        factors.bufferScore * weights.buffer +
        factors.weekdayScore * weights.weekday +
        factors.urgencyScore * weights.urgency +
        factors.durationMatchScore * weights.durationMatch +
        factors.preferenceScore * weights.preference) /
      100;

    return Math.max(0, Math.min(100, totalScore));
  }

  // ==========================================================================
  // INDIVIDUAL SCORING FUNCTIONS
  // ==========================================================================

  /**
   * Score based on time of day (0-100)
   * Afternoon (2-4 PM) = highest score
   */
  private scoreTimeOfDay(slot: RawSlot): number {
    const hour = slot.start.getHours();

    // Optimal: 2-4 PM (14-16)
    if (hour >= 14 && hour < 16) return 100;

    // Good: 10 AM - 2 PM or 4-5 PM
    if ((hour >= 10 && hour < 14) || (hour >= 16 && hour < 17)) return 80;

    // Acceptable: 9-10 AM or 5-6 PM
    if ((hour >= 9 && hour < 10) || (hour >= 17 && hour < 18)) return 60;

    // Early morning or late evening
    if (hour >= 8 || hour >= 18) return 40;

    // Outside working hours
    return 0;
  }

  /**
   * Score based on buffer availability (0-100)
   */
  private scoreBuffer(slot: RawSlot, busyPeriods: BusyPeriod[]): number {
    const hasBefore = this.hasBufferBefore(slot, busyPeriods);
    const hasAfter = this.hasBufferAfter(slot, busyPeriods);

    // Both buffers = excellent
    if (hasBefore && hasAfter) return 100;

    // One buffer = good
    if (hasBefore || hasAfter) return 70;

    // No buffers = acceptable but not ideal
    return 40;
  }

  /**
   * Score based on day of week (0-100)
   * Mid-week (Tue-Thu) = higher score
   */
  private scoreWeekday(slot: RawSlot): number {
    const dayOfWeek = slot.start.getDay();

    // Tuesday, Wednesday, Thursday = optimal
    if (dayOfWeek >= 2 && dayOfWeek <= 4) return 100;

    // Monday, Friday = good
    if (dayOfWeek === 1 || dayOfWeek === 5) return 80;

    // Weekend (should be filtered out, but just in case)
    return 0;
  }

  /**
   * Score based on urgency (0-100)
   */
  private scoreUrgency(slot: RawSlot, urgency?: 'urgent' | 'flexible'): number {
    if (!urgency) return 50; // Neutral

    const now = new Date();
    const hoursAway = (slot.start.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (urgency === 'urgent') {
      // Prefer sooner slots
      if (hoursAway <= 24) return 100; // Within 24 hours
      if (hoursAway <= 48) return 80;  // Within 2 days
      if (hoursAway <= 72) return 60;  // Within 3 days
      return 40;
    } else {
      // Prefer later slots (more time to prepare)
      if (hoursAway >= 168) return 100; // Week or more
      if (hoursAway >= 72) return 80;   // 3+ days
      if (hoursAway >= 48) return 60;   // 2+ days
      return 40;
    }
  }

  /**
   * Score based on duration match (0-100)
   */
  private scoreDurationMatch(slotDuration: number, requestedDuration: number): number {
    if (slotDuration === requestedDuration) return 100; // Perfect match

    const difference = Math.abs(slotDuration - requestedDuration);

    // Within 15 minutes
    if (difference <= 15) return 80;

    // Within 30 minutes
    if (difference <= 30) return 60;

    // More than 30 minutes off
    return 40;
  }

  /**
   * Score based on user preferences (0-100)
   */
  private scorePreference(
    slot: RawSlot,
    preferences?: {
      timeOfDay?: TimeOfDay[];
      urgency?: 'urgent' | 'flexible';
    }
  ): number {
    if (!preferences) return 50; // Neutral

    let score = 50;

    // Time of day preference
    if (preferences.timeOfDay && preferences.timeOfDay.length > 0) {
      const slotTimeOfDay = this.getTimeOfDay(slot);
      if (preferences.timeOfDay.includes(slotTimeOfDay)) {
        score += 50;
      }
    }

    return Math.min(100, score);
  }

  // ==========================================================================
  // REASON & WARNING GENERATION
  // ==========================================================================

  /**
   * Generate human-readable reasons why a slot is good
   */
  private generateReasons(
    factors: SlotQualityFactors,
    slot: RawSlot,
    timeOfDay: TimeOfDay
  ): string[] {
    const reasons: string[] = [];

    // Time of day reasons
    if (factors.timeOfDayScore >= 90) {
      reasons.push('Optimal afternoon time slot');
    } else if (factors.timeOfDayScore >= 75) {
      reasons.push('Good time for focused work');
    }

    // Buffer reasons
    if (factors.bufferScore === 100) {
      reasons.push('Has buffer time before and after');
    } else if (factors.bufferScore >= 70) {
      reasons.push('Has buffer time on one side');
    }

    // Weekday reasons
    if (factors.weekdayScore === 100) {
      reasons.push('Mid-week slot (less rushed)');
    }

    // Duration match
    if (factors.durationMatchScore === 100) {
      reasons.push('Perfect duration match');
    }

    // Time-specific insights
    const hour = slot.start.getHours();
    if (hour >= 14 && hour < 16) {
      reasons.push('Peak productivity hours');
    }

    return reasons;
  }

  /**
   * Generate warnings for potential issues
   */
  private generateWarnings(
    factors: SlotQualityFactors,
    slot: RawSlot,
    hasBufferBefore: boolean,
    hasBufferAfter: boolean
  ): string[] {
    const warnings: string[] = [];

    // Buffer warnings
    if (!hasBufferBefore && !hasBufferAfter) {
      warnings.push('Back-to-back meetings (no buffer time)');
    } else if (!hasBufferBefore) {
      warnings.push('Meeting immediately follows another');
    } else if (!hasBufferAfter) {
      warnings.push('Meeting immediately before another');
    }

    // Time warnings
    const hour = slot.start.getHours();
    if (hour < 9) {
      warnings.push('Early morning slot');
    } else if (hour >= 17) {
      warnings.push('Late afternoon slot');
    }

    // Monday/Friday warnings
    const dayOfWeek = slot.start.getDay();
    if (dayOfWeek === 1) {
      warnings.push('Monday - typically busier');
    } else if (dayOfWeek === 5) {
      warnings.push('Friday - end of week');
    }

    return warnings;
  }

  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================

  /**
   * Get time of day classification
   */
  private getTimeOfDay(slot: RawSlot): TimeOfDay {
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
  private hasBufferBefore(slot: RawSlot, busyPeriods: BusyPeriod[]): boolean {
    const bufferMinutes = CALENDAR_CONFIG.meeting.bufferTime;
    const bufferStart = new Date(slot.start.getTime() - bufferMinutes * 60 * 1000);

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
  private hasBufferAfter(slot: RawSlot, busyPeriods: BusyPeriod[]): boolean {
    const bufferMinutes = CALENDAR_CONFIG.meeting.bufferTime;
    const bufferEnd = new Date(slot.end.getTime() + bufferMinutes * 60 * 1000);

    for (const busy of busyPeriods) {
      if (busy.start >= slot.end && busy.start < bufferEnd) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if slot matches user preferences
   */
  private isPreferredSlot(
    slot: RawSlot,
    preferences?: {
      timeOfDay?: TimeOfDay[];
      urgency?: 'urgent' | 'flexible';
    }
  ): boolean {
    if (!preferences) return false;

    if (preferences.timeOfDay && preferences.timeOfDay.length > 0) {
      const slotTimeOfDay = this.getTimeOfDay(slot);
      return preferences.timeOfDay.includes(slotTimeOfDay);
    }

    return false;
  }

  /**
   * Generate unique slot ID
   */
  private generateSlotId(slot: RawSlot): string {
    return `slot_${slot.start.getTime()}_${slot.duration}`;
  }

  /**
   * Get timezone offset in minutes
   */
  private getTimezoneOffset(timezone: string, date: Date): number {
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    return (tzDate.getTime() - utcDate.getTime()) / (1000 * 60);
  }

  /**
   * Validate that weights sum to 100
   */
  private validateWeights(): void {
    const weights = this.config.weights;
    const total =
      weights.timeOfDay +
      weights.buffer +
      weights.weekday +
      weights.urgency +
      weights.durationMatch +
      weights.preference;

    if (Math.abs(total - 100) > 0.01) {
      console.warn(
        `Warning: Ranking weights sum to ${total}, not 100. Results may be skewed.`
      );
    }
  }

  // ==========================================================================
  // ANALYSIS FUNCTIONS
  // ==========================================================================

  /**
   * Get top N slots
   */
  getTopSlots(slots: SmartSlot[], n: number = 5): SmartSlot[] {
    return slots.slice(0, n);
  }

  /**
   * Get optimal slots (score >= threshold)
   */
  getOptimalSlots(slots: SmartSlot[]): SmartSlot[] {
    return slots.filter((slot) => slot.isOptimal);
  }

  /**
   * Group slots by day
   */
  groupSlotsByDay(slots: SmartSlot[]): Map<string, SmartSlot[]> {
    const grouped = new Map<string, SmartSlot[]>();

    for (const slot of slots) {
      const dateKey = slot.start.toISOString().split('T')[0];
      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }
      grouped.get(dateKey)!.push(slot);
    }

    return grouped;
  }

  /**
   * Get average quality score
   */
  getAverageQualityScore(slots: SmartSlot[]): number {
    if (slots.length === 0) return 0;
    const sum = slots.reduce((acc, slot) => acc + slot.qualityScore, 0);
    return Math.round(sum / slots.length);
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let slotRankerInstance: SlotRanker | null = null;

/**
 * Get singleton slot ranker instance
 */
export function getSlotRankerInstance(
  customConfig?: Partial<RankingConfig>
): SlotRanker {
  if (!slotRankerInstance || customConfig) {
    slotRankerInstance = new SlotRanker(customConfig);
  }
  return slotRankerInstance;
}
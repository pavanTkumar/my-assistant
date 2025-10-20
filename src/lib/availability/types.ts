/**
 * Type definitions for the Smart Availability Engine
 * Comprehensive interfaces for slots, availability, and scheduling
 */

// ============================================================================
// SLOT TYPES
// ============================================================================

/**
 * Raw time slot from calendar
 */
export interface RawSlot {
    start: Date;
    end: Date;
    duration: number; // minutes
  }
  
  /**
   * Smart slot with quality scoring and metadata
   */
  export interface SmartSlot {
    id: string; // Unique identifier
    start: Date;
    end: Date;
    duration: number; // minutes
    
    // Formatting helpers
    startTimeFormatted: string; // "2:00 PM"
    endTimeFormatted: string;   // "3:00 PM"
    dateFormatted: string;      // "Monday, Oct 21"
    
    // Quality metrics
    qualityScore: number;       // 0-100
    isOptimal: boolean;         // Top 20% of scores
    
    // Context
    reasons: string[];          // Why this slot is good/bad
    warnings: string[];         // Potential issues
    
    // Metadata
    metadata: {
      hasBufferBefore: boolean;
      hasBufferAfter: boolean;
      timeOfDay: TimeOfDay;
      isPreferred: boolean;     // Based on user preferences
      conflicts: SlotConflict[];
    };
    
    // Timezone
    timezone: string;
    timezoneOffset: number;     // minutes from UTC
  }
  
  /**
   * Slot conflict information
   */
  export interface SlotConflict {
    type: 'busy' | 'buffer' | 'locked' | 'blackout';
    start: Date;
    end: Date;
    reason: string;
  }
  
  /**
   * Time of day classification
   */
  export type TimeOfDay = 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'night';
  
  // ============================================================================
  // AVAILABILITY REQUEST/RESPONSE
  // ============================================================================
  
  /**
   * Request for availability
   */
  export interface AvailabilityRequest {
    // Date range
    startDate: Date;
    endDate: Date;
    
    // Meeting requirements
    duration: number;           // minutes
    meetingTypeId?: string;     // Use meeting type settings
    
    // User preferences
    preferences?: {
      timeOfDay?: TimeOfDay[];  // Preferred times
      timezone?: string;         // User timezone
      flexibleDuration?: boolean; // Allow shorter/longer slots
      urgency?: 'urgent' | 'flexible';
    };
    
    // Filters
    includeWeekends?: boolean;
    maxSlotsPerDay?: number;
    
    // Context
    userId?: string;
    sessionId?: string;
  }
  
  /**
   * Availability response
   */
  export interface AvailabilityResponse {
    success: boolean;
    slots: SmartSlot[];
    
    // Metadata
    metadata: {
      totalSlotsFound: number;
      dateRange: {
        start: string; // ISO string
        end: string;
      };
      queriedAt: string; // ISO string
      cacheHit: boolean;
      generationTime: number; // milliseconds
    };
    
    // Context
    timezone: string;
    workingHours: {
      start: number;
      end: number;
    };
    
    // Suggestions if no slots found
    suggestions?: AvailabilitySuggestion[];
  }
  
  /**
   * Suggestion when no slots available
   */
  export interface AvailabilitySuggestion {
    type: 'alternative_time' | 'alternative_duration' | 'waitlist' | 'future_date';
    message: string;
    action?: {
      type: string;
      data: any;
    };
  }
  
  // ============================================================================
  // CALENDAR INTEGRATION
  // ============================================================================
  
  /**
   * Busy period from calendar
   */
  export interface BusyPeriod {
    start: Date;
    end: Date;
    summary?: string;
    isAllDay?: boolean;
  }
  
  /**
   * Calendar free/busy response
   */
  export interface FreeBusyResponse {
    timezone: string;
    busyPeriods: BusyPeriod[];
    queriedRange: {
      start: Date;
      end: Date;
    };
  }
  
  // ============================================================================
  // SLOT GENERATION CONFIG
  // ============================================================================
  
  /**
   * Configuration for slot generation
   */
  export interface SlotGenerationConfig {
    // Working hours
    workingHours: {
      start: number; // 9
      end: number;   // 18
    };
    
    // Time constraints
    minAdvanceNotice: number;   // minutes
    maxAdvanceBooking: number;  // days
    bufferTime: number;         // minutes between meetings
    
    // Slot settings
    slotInterval: number;       // minutes (e.g., 30)
    maxSlotsPerDay: number;
    
    // Blackout periods
    blackoutDates: string[];    // ISO date strings
    blackoutWeekdays: number[]; // 0-6 (Sunday-Saturday)
    
    // Timezone
    timezone: string;
  }
  
  // ============================================================================
  // SLOT RANKING
  // ============================================================================
  
  /**
   * Slot quality factors
   */
  export interface SlotQualityFactors {
    timeOfDayScore: number;     // Afternoon = higher
    bufferScore: number;        // Has buffers = higher
    weekdayScore: number;       // Mid-week = higher
    urgencyScore: number;       // Sooner = higher for urgent
    durationMatchScore: number; // Exact match = higher
    preferenceScore: number;    // Matches user prefs = higher
  }
  
  /**
   * Ranking configuration
   */
  export interface RankingConfig {
    // Weights for scoring (sum = 100)
    weights: {
      timeOfDay: number;        // Default: 30
      buffer: number;           // Default: 20
      weekday: number;          // Default: 15
      urgency: number;          // Default: 15
      durationMatch: number;    // Default: 10
      preference: number;       // Default: 10
    };
    
    // Preferences
    preferredTimeOfDay: TimeOfDay[];
    preferredWeekdays: number[];
    
    // Thresholds
    optimalScoreThreshold: number; // Top 20% = optimal
  }
  
  // ============================================================================
  // TIMEZONE HANDLING
  // ============================================================================
  
  /**
   * Timezone information
   */
  export interface TimezoneInfo {
    timezone: string;           // IANA timezone (e.g., "America/New_York")
    abbreviation: string;       // e.g., "EST"
    offset: number;             // minutes from UTC
    isDST: boolean;             // Daylight Saving Time active
  }
  
  /**
   * Timezone conversion request
   */
  export interface TimezoneConversion {
    datetime: Date;
    fromTimezone: string;
    toTimezone: string;
  }
  
  // ============================================================================
  // CACHE
  // ============================================================================
  
  /**
   * Cache key structure
   */
  export interface CacheKey {
    type: 'availability' | 'calendar' | 'slots';
    identifier: string;
    params?: Record<string, any>;
  }
  
  /**
   * Cached availability data
   */
  export interface CachedAvailability {
    slots: SmartSlot[];
    generatedAt: string; // ISO string
    expiresAt: string;   // ISO string
    params: AvailabilityRequest;
  }
  
  // ============================================================================
  // ERRORS
  // ============================================================================
  
  /**
   * Availability error types
   */
  export type AvailabilityErrorCode =
    | 'CALENDAR_ERROR'
    | 'NO_SLOTS_AVAILABLE'
    | 'INVALID_DATE_RANGE'
    | 'INVALID_DURATION'
    | 'INVALID_TIMEZONE'
    | 'RATE_LIMIT_EXCEEDED'
    | 'CACHE_ERROR'
    | 'UNKNOWN_ERROR';
  
  /**
   * Availability error
   */
  export interface AvailabilityError {
    code: AvailabilityErrorCode;
    message: string;
    details?: any;
    suggestions?: string[];
  }
  
  // ============================================================================
  // ANALYTICS
  // ============================================================================
  
  /**
   * Availability query analytics
   */
  export interface AvailabilityAnalytics {
    requestId: string;
    userId?: string;
    sessionId?: string;
    
    // Query details
    duration: number;
    dateRange: { start: string; end: string };
    timezone: string;
    
    // Results
    slotsFound: number;
    cacheHit: boolean;
    generationTime: number; // milliseconds
    
    // User behavior
    selectedSlot?: string; // slot ID if user books
    dropOffStage?: string; // If user abandons
    
    timestamp: string;
  }
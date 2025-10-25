/**
 * Booking Intent Detection
 */

export const BOOKING_INTENT_PATTERNS = {
    schedule: [
      /schedule\s+(a\s+)?meeting/i,
      /book\s+(a\s+)?meeting/i,
      /set\s+up\s+(a\s+)?meeting/i,
      /arrange\s+(a\s+)?meeting/i,
    ],
    availability: [
      /when\s+(are\s+you|am\s+I)\s+available/i,
      /what.*available/i,
      /check.*availability/i,
      /free\s+time/i,
      /open\s+slot/i,
    ],
    calendar: [/show.*calendar/i, /view.*schedule/i, /my\s+calendar/i],
    timeSpecific: [
      /available\s+(on|next|this)/i,
      /free\s+(on|next|this)/i,
      /can\s+(we|I)\s+meet/i,
    ],
  };
  
  export type BookingIntent =
    | 'schedule_meeting'
    | 'check_availability'
    | 'view_calendar'
    | 'time_specific_query'
    | 'none';
  
  export function detectBookingIntent(userMessage: string): {
    intent: BookingIntent;
    confidence: number;
  } {
    const normalizedMessage = userMessage.toLowerCase().trim();
  
    for (const pattern of BOOKING_INTENT_PATTERNS.schedule) {
      if (pattern.test(normalizedMessage)) {
        return { intent: 'schedule_meeting', confidence: 0.95 };
      }
    }
  
    for (const pattern of BOOKING_INTENT_PATTERNS.availability) {
      if (pattern.test(normalizedMessage)) {
        return { intent: 'check_availability', confidence: 0.9 };
      }
    }
  
    for (const pattern of BOOKING_INTENT_PATTERNS.calendar) {
      if (pattern.test(normalizedMessage)) {
        return { intent: 'view_calendar', confidence: 0.85 };
      }
    }
  
    for (const pattern of BOOKING_INTENT_PATTERNS.timeSpecific) {
      if (pattern.test(normalizedMessage)) {
        return { intent: 'time_specific_query', confidence: 0.8 };
      }
    }
  
    return { intent: 'none', confidence: 0 };
  }
  
  export interface BookingContext {
    hasDateMention: boolean;
    hasTimeMention: boolean;
    hasDurationMention: boolean;
    isFollowUp: boolean;
    suggestedAction: 'query_availability' | 'ask_for_details' | 'confirm_booking' | 'none';
  }
  
  export function analyzeBookingContext(
    userMessage: string,
    conversationHistory: string[]
  ): BookingContext {
    const normalizedMessage = userMessage.toLowerCase();
  
    const dateKeywords = [
      'today',
      'tomorrow',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'next week',
      'this week',
    ];
    const hasDateMention = dateKeywords.some((keyword) => normalizedMessage.includes(keyword));
  
    const timeKeywords = ['morning', 'afternoon', 'evening', 'am', 'pm', 'oclock'];
    const hasTimeMention = timeKeywords.some((keyword) => normalizedMessage.includes(keyword));
  
    const durationKeywords = ['hour', 'minute', 'min', 'hr', 'quick', 'brief', 'long'];
    const hasDurationMention = durationKeywords.some((keyword) => normalizedMessage.includes(keyword));
  
    const isFollowUp = conversationHistory.some((msg) => {
      const intent = detectBookingIntent(msg);
      return intent.confidence > 0.7;
    });
  
    let suggestedAction: BookingContext['suggestedAction'] = 'none';
  
    if (hasDateMention && (hasDurationMention || isFollowUp)) {
      suggestedAction = 'query_availability';
    } else if (detectBookingIntent(userMessage).confidence > 0.8 && !hasDateMention) {
      suggestedAction = 'ask_for_details';
    } else if (isFollowUp && normalizedMessage.includes('book')) {
      suggestedAction = 'confirm_booking';
    }
  
    return {
      hasDateMention,
      hasTimeMention,
      hasDurationMention,
      isFollowUp,
      suggestedAction,
    };
  }
  
  export const BOOKING_RESPONSE_TEMPLATES = {
    needMoreInfo: [
      'I would be happy to help you schedule a meeting! When would you like to meet?',
      'Sure! What date and time works best for you?',
      'I can check my availability. When are you thinking?',
    ],
    showingAvailability: [
      'Here are my available times:',
      'I found some available slots. Here are the best options:',
      'Looking at my calendar, here is when I am free:',
    ],
    noSlotsAvailable: [
      'I do not have any availability during that time. Would you like to try different dates?',
      'My calendar is full then. How about the following week?',
      'I am booked during that period. Can we look at alternative times?',
    ],
    confirmBooking: [
      'Perfect! I have you down for that time. Shall I confirm this booking?',
      'Great! Should I book this time slot for you?',
      'I have found a slot. Would you like me to book this?',
    ],
  };
  
  export function getRandomTemplate(templates: string[]): string {
    return templates[Math.floor(Math.random() * templates.length)];
  }
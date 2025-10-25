/**
 * Availability Tool for LangChain
 */

import { getAvailabilityEngineInstance } from '../availability/engine';

export async function checkAvailability(params: {
  startDate: string;
  endDate: string;
  duration: number;
  preferences?: any;
}): Promise<string> {
  try {
    const { startDate, endDate, duration, preferences } = params;

    console.log('🔍 Checking availability:', params);

    const engine = getAvailabilityEngineInstance();

    const response = await engine.getAvailability({
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      duration,
      preferences,
    });

    if (!response.success || response.slots.length === 0) {
      return JSON.stringify({
        success: false,
        message: 'No available slots found.',
        suggestions: response.suggestions || [],
      });
    }

    const topSlots = response.slots.slice(0, 5).map((slot) => ({
      id: slot.id,
      date: slot.dateFormatted,
      time: `${slot.startTimeFormatted} - ${slot.endTimeFormatted}`,
      score: slot.qualityScore,
      isOptimal: slot.isOptimal,
      reasons: slot.reasons,
    }));

    return JSON.stringify({
      success: true,
      totalSlotsFound: response.metadata.totalSlotsFound,
      topSlots,
      message: `Found ${response.metadata.totalSlotsFound} available slots.`,
    });
  } catch (error: any) {
    return JSON.stringify({
      success: false,
      error: error.message,
      message: 'Failed to check availability.',
    });
  }
}

export function parseUserDateInput(input: string): { startDate: Date; endDate: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const normalized = input.toLowerCase().trim();

  if (normalized === 'today') {
    return { startDate: today, endDate: new Date(today.getTime() + 86400000) };
  }

  if (normalized === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { startDate: tomorrow, endDate: new Date(tomorrow.getTime() + 86400000) };
  }

  if (normalized.includes('next week')) {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const weekEnd = new Date(nextWeek);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return { startDate: nextWeek, endDate: weekEnd };
  }

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < days.length; i++) {
    if (normalized.includes(days[i])) {
      const daysUntil = (i - today.getDay() + 7) % 7 || 7;
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + daysUntil);
      return { startDate: targetDate, endDate: new Date(targetDate.getTime() + 86400000) };
    }
  }

  return { startDate: today, endDate: new Date(today.getTime() + 604800000) };
}

export function extractDuration(text: string): number {
  const match = text.match(/(\d+)\s*(hour|hr|min|minute)/i);
  if (match) {
    const num = parseInt(match[1]);
    return match[2].toLowerCase().startsWith('h') ? num * 60 : num;
  }
  if (text.includes('quick')) return 15;
  if (text.includes('long')) return 120;
  return 30;
}

export function extractTimePreferences(text: string): any {
  const prefs: any = {};
  const timeOfDay: string[] = [];

  if (text.includes('morning')) timeOfDay.push('morning');
  if (text.includes('afternoon')) timeOfDay.push('afternoon');
  if (text.includes('evening')) timeOfDay.push('evening');

  if (timeOfDay.length > 0) prefs.timeOfDay = timeOfDay;
  if (text.includes('urgent') || text.includes('asap')) prefs.urgency = 'urgent';

  return prefs;
}
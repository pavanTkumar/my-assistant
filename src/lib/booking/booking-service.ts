/**
 * Booking Service - Production Ready
 * Handles booking creation, validation, and management
 */

import { prisma } from '@/lib/db/prisma';
import { getCalendarClientInstance } from '../availability/calendar-client';
import { getCacheManagerInstance } from '../availability/cache-manager';

export interface CreateBookingParams {
  userName: string;
  userEmail: string;
  userPhone?: string;
  slotId: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  meetingTypeId?: string;
  title?: string;
  description?: string;
  notes?: string;
  timezone: string;
  source?: string;
}

export async function createBooking(params: CreateBookingParams) {
  console.log('📅 Creating booking:', {
    ...params,
    startTime: params.startTime instanceof Date ? params.startTime.toISOString() : params.startTime,
    endTime: params.endTime instanceof Date ? params.endTime.toISOString() : params.endTime,
  });

  try {
    // Validate that startTime and endTime are Date objects
    if (!(params.startTime instanceof Date) || !(params.endTime instanceof Date)) {
      throw new Error('startTime and endTime must be Date objects');
    }

    // Validate that dates are valid
    if (isNaN(params.startTime.getTime()) || isNaN(params.endTime.getTime())) {
      throw new Error('Invalid date values provided');
    }

    // Validate that end time is after start time
    if (params.endTime <= params.startTime) {
      throw new Error('End time must be after start time');
    }

    // Step 1: Check if slot is still available
    const calendarClient = getCalendarClientInstance();
    const isAvailable = await calendarClient.isSlotAvailable(
      params.startTime,
      params.endTime,
      params.timezone
    );

    if (!isAvailable) {
      throw new Error('Selected slot is no longer available');
    }

    // Step 2: Check if slot is locked
    const cacheManager = getCacheManagerInstance();
    const isLocked = await cacheManager.isSlotLocked(params.slotId);

    if (isLocked) {
      throw new Error('Slot is temporarily reserved by another user');
    }

    // Step 3: Generate confirmation code
    const confirmationCode = generateConfirmationCode(params.userName);

    // Step 4: Create booking in database
    const booking = await prisma.booking.create({
      data: {
        name: params.userName,
        email: params.userEmail,
        phone: params.userPhone || '',
        scheduledDate: params.startTime,
        startTime: params.startTime,
        endTime: params.endTime,
        duration: params.duration,
        meetingTypeId: params.meetingTypeId || null,
        purpose: params.description || `Meeting with ${params.userName}`,
        notes: params.notes || null,
        timezone: params.timezone,
        status: 'CONFIRMED',
        confirmationCode: confirmationCode,
        isRecurring: false,
        createdVia: params.source || 'chat',
      },
    });

    console.log('✅ Booking created in database:', booking.id);

    // Step 5: Add to Google Calendar (non-blocking)
    addToGoogleCalendar(booking, params.userEmail).catch((error) => {
      console.error('⚠️  Failed to add to Google Calendar:', error.message);
      // Don't throw - booking is already created
    });

    // Step 6: Invalidate availability cache
    try {
      const dateStr = params.startTime.toISOString().split('T')[0];
      await cacheManager.invalidateDate(dateStr);
      console.log('✅ Cache invalidated for date:', dateStr);
    } catch (error) {
      console.error('⚠️  Cache invalidation failed:', error);
      // Don't throw - booking is already created
    }

    // Step 7: Track analytics (non-blocking)
    trackBookingEvent({
      bookingId: booking.id,
      eventType: 'booking_created',
      source: params.source || 'chat',
      metadata: {
        duration: params.duration,
        timezone: params.timezone,
        slotId: params.slotId,
      },
    }).catch((error) => {
      console.error('⚠️  Analytics tracking failed:', error);
      // Don't throw - booking is already created
    });

    return {
      success: true,
      booking: {
        id: booking.id,
        confirmationCode: booking.confirmationCode,
        startTime: booking.startTime,
        endTime: booking.endTime,
        duration: booking.duration,
        purpose: booking.purpose,
        status: booking.status,
      },
    };
  } catch (error: any) {
    console.error('❌ Booking creation failed:', error);
    throw error;
  }
}

function generateConfirmationCode(userName: string): string {
  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);
  const timestamp = Date.now().toString(36).toUpperCase().slice(-6);
  const random = Math.random().toString(36).substring(2, 4).toUpperCase();
  return `${initials}${timestamp}${random}`;
}

async function addToGoogleCalendar(booking: any, userEmail: string): Promise<void> {
  try {
    const { google } = await import('googleapis');
    const { JWT } = await import('google-auth-library');

    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!privateKey || !process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_CALENDAR_ID) {
      throw new Error('Google Calendar credentials not configured');
    }

    const jwtClient = new JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    const calendar = google.calendar({ version: 'v3', auth: jwtClient });

    const event = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: booking.purpose,
        description: `Meeting with ${booking.name}\nEmail: ${userEmail}\nConfirmation: ${booking.confirmationCode}`,
        start: {
          dateTime: booking.startTime.toISOString(),
          timeZone: booking.timezone,
        },
        end: {
          dateTime: booking.endTime.toISOString(),
          timeZone: booking.timezone,
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'popup', minutes: 30 },
          ],
        },
      },
    });

    await prisma.booking.update({
      where: { id: booking.id },
      data: { googleEventId: event.data.id || null },
    });

    console.log('✅ Added to Google Calendar:', event.data.id);
  } catch (error: any) {
    console.error('❌ Google Calendar error:', error.message);
    throw error;
  }
}

export async function getBooking(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
  });

  if (!booking) {
    throw new Error('Booking not found');
  }

  return booking;
}

export async function getBookingByConfirmationCode(code: string) {
  const bookings = await prisma.booking.findMany({
    where: {
      confirmationCode: code.toUpperCase(),
    },
    take: 1,
  });

  if (bookings.length === 0) {
    throw new Error('Booking not found with that confirmation code');
  }

  return bookings[0];
}

export async function cancelBooking(bookingId: string, reason?: string) {
  console.log('🚫 Cancelling booking:', bookingId);

  const booking = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancellationReason: reason || 'Cancelled by user',
    },
  });

  try {
    const cacheManager = getCacheManagerInstance();
    const dateStr = booking.startTime.toISOString().split('T')[0];
    await cacheManager.invalidateDate(dateStr);
  } catch (error) {
    console.error('⚠️  Cache invalidation failed during cancellation:', error);
  }

  trackBookingEvent({
    bookingId: booking.id,
    eventType: 'booking_cancelled',
    metadata: { reason },
  }).catch((error) => {
    console.error('⚠️  Analytics tracking failed:', error);
  });

  console.log('✅ Booking cancelled');

  return { success: true, booking };
}

export async function rescheduleBooking(
  bookingId: string,
  newStartTime: Date,
  newEndTime: Date
) {
  console.log('🔄 Rescheduling booking:', bookingId);

  if (!(newStartTime instanceof Date) || !(newEndTime instanceof Date)) {
    throw new Error('Invalid date objects provided');
  }

  const calendarClient = getCalendarClientInstance();
  const isAvailable = await calendarClient.isSlotAvailable(newStartTime, newEndTime);

  if (!isAvailable) {
    throw new Error('New slot is not available');
  }

  const booking = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      scheduledDate: newStartTime,
      startTime: newStartTime,
      endTime: newEndTime,
      notes: 'Rescheduled from original time',
    },
  });

  try {
    const cacheManager = getCacheManagerInstance();
    const oldDateStr = booking.startTime.toISOString().split('T')[0];
    const newDateStr = newStartTime.toISOString().split('T')[0];
    await cacheManager.invalidateDate(oldDateStr);
    if (oldDateStr !== newDateStr) {
      await cacheManager.invalidateDate(newDateStr);
    }
  } catch (error) {
    console.error('⚠️  Cache invalidation failed during reschedule:', error);
  }

  console.log('✅ Booking rescheduled');

  return { success: true, booking };
}

async function trackBookingEvent(params: {
  bookingId: string;
  eventType: string;
  source?: string;
  metadata?: any;
}): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        eventType: params.eventType as any,
        metadata: {
          bookingId: params.bookingId,
          source: params.source,
          timestamp: new Date().toISOString(),
          ...params.metadata,
        },
      },
    });
  } catch (error) {
    console.error('Analytics tracking error:', error);
    throw error;
  }
}

export async function getUserBookings(email: string) {
  const bookings = await prisma.booking.findMany({
    where: {
      email,
      status: { not: 'CANCELLED' },
      startTime: { gte: new Date() },
    },
    orderBy: { startTime: 'asc' },
  });

  return bookings;
}

export function validateBookingParams(params: CreateBookingParams): string[] {
  const errors: string[] = [];

  if (!params.userName || params.userName.trim().length === 0) {
    errors.push('User name is required');
  }

  if (!params.userEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.userEmail)) {
    errors.push('Valid email is required');
  }

  if (!(params.startTime instanceof Date) || isNaN(params.startTime.getTime())) {
    errors.push('Valid start time is required');
  }

  if (!(params.endTime instanceof Date) || isNaN(params.endTime.getTime())) {
    errors.push('Valid end time is required');
  }

  if (params.startTime && params.endTime && params.endTime <= params.startTime) {
    errors.push('End time must be after start time');
  }

  if (!params.duration || params.duration < 15 || params.duration > 480) {
    errors.push('Duration must be between 15 and 480 minutes');
  }

  return errors;
}
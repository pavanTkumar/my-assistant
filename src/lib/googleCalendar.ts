import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// Service account auth — no refresh tokens, never expires
const getAuth = (): JWT => {
  return new JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
};

const getCalendarClient = () => {
  return google.calendar({ version: 'v3', auth: getAuth() });
};

const calendarId = (): string =>
  process.env.GOOGLE_CALENDAR_ID || process.env.CALENDAR_ID || 'primary';

// Check available slots for a given date
export async function getAvailableSlots(date: string) {
  try {
    const calendar = getCalendarClient();
    const targetDate = new Date(date);

    // Set start and end of the day in IST
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get busy periods from Google Calendar
    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        timeZone: 'Asia/Kolkata',
        items: [{ id: calendarId() }],
      },
    });

    const busySlots =
      freeBusyResponse.data.calendars?.[calendarId()]?.busy || [];

    // Generate 30-minute slots within working hours (9 AM – 6 PM IST)
    const availableSlots = [];
    const now = new Date();

    for (let hour = 9; hour < 18; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const slotStart = new Date(targetDate);
        slotStart.setHours(hour, minute, 0, 0);

        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + 30);

        // Skip past slots
        if (slotStart <= now) continue;

        // Check overlap with busy periods
        const isSlotBusy = busySlots.some(busy => {
          const busyStart = new Date(busy.start || '');
          const busyEnd = new Date(busy.end || '');
          return (
            (slotStart >= busyStart && slotStart < busyEnd) ||
            (slotEnd > busyStart && slotEnd <= busyEnd) ||
            (slotStart <= busyStart && slotEnd >= busyEnd)
          );
        });

        if (!isSlotBusy) {
          availableSlots.push({
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            time: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
          });
        }
      }
    }

    return availableSlots;
  } catch (error) {
    console.error('Error fetching available slots:', error);
    throw error;
  }
}

// Book an appointment
export async function bookAppointment(
  name: string,
  email: string,
  date: string,
  time: string,
  duration: number = 30,
  purpose: string = 'Meeting'
) {
  try {
    const calendar = getCalendarClient();

    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);

    const startDateTime = new Date(year, month - 1, day, hour, minute);
    const endDateTime = new Date(startDateTime.getTime() + duration * 60 * 1000);

    const event = {
      summary: `Meeting with ${name}`,
      description: `${purpose}\n\nGuest: ${name}\nEmail: ${email}`,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'Asia/Kolkata',
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'Asia/Kolkata',
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup' as const, minutes: 10 },
        ],
      },
    };

    const response = await calendar.events.insert({
      calendarId: calendarId(),
      requestBody: event,
      sendUpdates: 'none',
    });

    return {
      success: true,
      eventId: response.data.id,
      eventLink: response.data.htmlLink,
    };
  } catch (error) {
    console.error('Error booking appointment:', error);
    throw error;
  }
}

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

// Working hours in IST (9 AM – 6 PM). IST is a fixed +05:30 offset (no DST),
// so every slot time is anchored to +05:30 to match bookAppointment(), which
// also pins +05:30. This keeps displayed slots and booked events on the same
// clock regardless of the server's timezone (UTC on Vercel).
const IST_OFFSET = '+05:30';
const WORKING_HOUR_START = 9;
const WORKING_HOUR_END = 18;
const pad2 = (n: number) => String(n).padStart(2, '0');

// Check available slots for a given date (YYYY-MM-DD, interpreted as IST).
export async function getAvailableSlots(date: string) {
  try {
    const calendar = getCalendarClient();

    // Full IST day window as absolute instants (midnight IST → next midnight IST).
    const dayStart = new Date(`${date}T00:00:00${IST_OFFSET}`);
    const dayEnd = new Date(`${date}T23:59:59${IST_OFFSET}`);

    // Get busy periods from Google Calendar for that IST day
    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        timeZone: 'Asia/Kolkata',
        items: [{ id: calendarId() }],
      },
    });

    const busySlots =
      freeBusyResponse.data.calendars?.[calendarId()]?.busy || [];

    // Generate 30-minute slots within IST working hours
    const availableSlots = [];
    const now = new Date();

    for (let hour = WORKING_HOUR_START; hour < WORKING_HOUR_END; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        // Anchor each slot to IST so its absolute instant matches what gets booked.
        const slotStart = new Date(`${date}T${pad2(hour)}:${pad2(minute)}:00${IST_OFFSET}`);
        const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

        // Skip slots already in the past (real instant comparison)
        if (slotStart <= now) continue;

        // Check overlap with busy periods (all Date objects are absolute instants)
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
            time: `${pad2(hour)}:${pad2(minute)}`, // IST clock time, matches booking input
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

    const [hour, minute] = time.split(':').map(Number);

    // Build ISO strings with explicit IST offset (+05:30) so the event
    // lands at the correct local time regardless of the server's timezone (UTC on Vercel)
    const totalEndMinutes = hour * 60 + minute + duration;
    const endHour = Math.floor(totalEndMinutes / 60) % 24;
    const endMinute = totalEndMinutes % 60;
    const startIST = `${date}T${pad2(hour)}:${pad2(minute)}:00${IST_OFFSET}`;
    const endIST = `${date}T${pad2(endHour)}:${pad2(endMinute)}:00${IST_OFFSET}`;

    const event = {
      summary: `Meeting with ${name}`,
      description: `${purpose}\n\nGuest: ${name}\nEmail: ${email}`,
      start: {
        dateTime: startIST,
        timeZone: 'Asia/Kolkata',
      },
      end: {
        dateTime: endIST,
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

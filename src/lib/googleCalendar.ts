import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// Initialize OAuth2 client
export const getOAuth2Client = (): OAuth2Client => {
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  return oauth2Client;
};

// Get Google Calendar client
export const getCalendarClient = () => {
  const auth = getOAuth2Client();
  return google.calendar({ version: 'v3', auth });
};

// Check available slots for a given date
export async function getAvailableSlots(date: string) {
  try {
    const calendar = getCalendarClient();
    const targetDate = new Date(date);
    
    // Set start and end of the day
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    // Get busy periods from Google Calendar
    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        timeZone: 'Asia/Kolkata', // Adjust this to your timezone
        items: [{ id: process.env.CALENDAR_ID || 'primary' }],
      },
    });
    
    const busySlots = freeBusyResponse.data.calendars?.[process.env.CALENDAR_ID || 'primary']?.busy || [];
    
    // Define working hours (9 AM to 5 PM)
    const workHourStart = 9;
    const workHourEnd = 17;
    
    // Generate 30-minute slots
    const availableSlots = [];
    
    for (let hour = workHourStart; hour < workHourEnd; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const slotStart = new Date(targetDate);
        slotStart.setHours(hour, minute, 0, 0);
        
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + 30);
        
        // Skip if slot is in the past
        const now = new Date();
        if (slotStart <= now) {
          continue;
        }
        
        // Check if slot overlaps with any busy period
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
    
    // Parse date and time strings
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    
    const startDateTime = new Date(year, month - 1, day, hour, minute);
    const endDateTime = new Date(startDateTime.getTime() + duration * 60 * 1000);
    
    // Create the calendar event
    const event = {
      summary: `Meeting with ${name}`,
      description: purpose,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'Asia/Kolkata', // Adjust this to your timezone
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'Asia/Kolkata', // Adjust this to your timezone
      },
      attendees: [{ email }],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 10 },
        ],
      },
    };
    
    const response = await calendar.events.insert({
      calendarId: process.env.CALENDAR_ID || 'primary',
      requestBody: event,
      sendUpdates: 'all', // Send updates to all attendees
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
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

/**
 * Initialize Google Calendar Service Account
 * Uses JWT authentication with JSON key credentials
 * 
 * Security: Private key stored in environment variables
 * Never commit google-service-account.json to git
 */

interface ServiceAccountConfig {
  clientEmail: string;
  privateKey: string;
  calendarId: string;
}

class CalendarServiceAccount {
  private static instance: CalendarServiceAccount;
  private jwtClient: JWT;
  private config: ServiceAccountConfig;

  private constructor() {
    this.config = this.loadConfig();
    this.jwtClient = this.initializeJWT();
  }

  /**
   * Singleton pattern - ensures single instance across app
   */
  public static getInstance(): CalendarServiceAccount {
    if (!CalendarServiceAccount.instance) {
      CalendarServiceAccount.instance = new CalendarServiceAccount();
    }
    return CalendarServiceAccount.instance;
  }

  /**
   * Load configuration from environment variables
   * Validates all required fields are present
   */
  private loadConfig(): ServiceAccountConfig {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    if (!clientEmail || !privateKey || !calendarId) {
      throw new Error(
        'Missing required Google Calendar configuration. ' +
        'Ensure GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_CALENDAR_ID are set.'
      );
    }

    // Unescape the private key (handles \n in env variables)
    const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

    return {
      clientEmail,
      privateKey: formattedPrivateKey,
      calendarId,
    };
  }

  /**
   * Initialize JWT client for service account authentication
   * Scopes: Full calendar access for reading/writing events
   */
  private initializeJWT(): JWT {
    return new google.auth.JWT({
      email: this.config.clientEmail,
      key: this.config.privateKey,
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ],
    });
  }

  /**
   * Get authenticated calendar client
   * This is the main method used throughout the app
   */
  public getCalendarClient() {
    return google.calendar({
      version: 'v3',
      auth: this.jwtClient,
    });
  }

  /**
   * Get calendar ID
   */
  public getCalendarId(): string {
    return this.config.calendarId;
  }

  /**
   * Test connection to Google Calendar API
   * Useful for health checks and initialization validation
   */
  public async testConnection(): Promise<{
    success: boolean;
    message: string;
    calendarName?: string;
  }> {
    try {
      const calendar = this.getCalendarClient();
      
      // Attempt to fetch calendar details
      const response = await calendar.calendars.get({
        calendarId: this.config.calendarId,
      });

      return {
        success: true,
        message: 'Successfully connected to Google Calendar',
        calendarName: response.data.summary || 'Unknown',
      };
    } catch (error: any) {
      console.error('Google Calendar connection test failed:', error);
      
      return {
        success: false,
        message: `Connection failed: ${error.message}`,
      };
    }
  }

  /**
   * Authorize and refresh tokens if needed
   * JWT automatically handles token refresh
   */
  public async authorize(): Promise<void> {
    try {
      await this.jwtClient.authorize();
    } catch (error: any) {
      throw new Error(`Failed to authorize service account: ${error.message}`);
    }
  }
}

// Lazy singleton — do NOT instantiate at module level to avoid build-time failures
// when Google Calendar env vars are missing. Callers must use getInstance() directly.
export const getCalendarClient = () => CalendarServiceAccount.getInstance().getCalendarClient();
export const getCalendarId = () => CalendarServiceAccount.getInstance().getCalendarId();
export const testCalendarConnection = () => CalendarServiceAccount.getInstance().testConnection();
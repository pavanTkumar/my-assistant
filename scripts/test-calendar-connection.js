/**
 * Test Script: Verify Google Calendar Connection
 * 
 * Usage: node scripts/test-calendar-connection.js
 */

const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testConnection() {
  console.log('\n🔍 Testing Google Calendar Connection...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Import the service account module
    const { google } = require('googleapis');
    const { JWT } = require('google-auth-library');

    // Validate environment variables
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    if (!clientEmail || !privateKey || !calendarId) {
      throw new Error(
        '❌ Missing required environment variables!\n\n' +
        'Please ensure these are set in .env.local:\n' +
        '  - GOOGLE_CLIENT_EMAIL\n' +
        '  - GOOGLE_PRIVATE_KEY\n' +
        '  - GOOGLE_CALENDAR_ID\n'
      );
    }

    console.log('✓ Environment variables found');
    console.log(`  Client Email: ${clientEmail}`);
    console.log(`  Calendar ID: ${calendarId}\n`);

    // Format private key (handle escaped newlines)
    const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

    // Initialize JWT client
    console.log('⚙️  Initializing JWT client...');
    const jwtClient = new JWT({
      email: clientEmail,
      key: formattedPrivateKey,
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ],
    });

    // Authorize
    console.log('🔐 Authorizing...');
    await jwtClient.authorize();
    console.log('✓ Authorization successful\n');

    // Create calendar client
    const calendar = google.calendar({
      version: 'v3',
      auth: jwtClient,
    });

    // Test connection by fetching calendar details
    console.log('📅 Fetching calendar details...');
    const response = await calendar.calendars.get({
      calendarId: calendarId,
    });

    console.log('✓ Calendar API connection successful\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('✅ SUCCESS!');
    console.log(`📅 Connected to: ${response.data.summary || 'Calendar'}`);
    console.log(`🆔 Calendar ID: ${response.data.id}`);
    console.log(`⏰ Timezone: ${response.data.timeZone || 'Not specified'}`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🎉 Your Google Calendar integration is working!\n');
    console.log('Next steps:');
    console.log('1. ✅ Calendar connection verified');
    console.log('2. 📋 Ready to proceed with Step 2: Database Setup');
    console.log('3. 🚀 Continue building the smart availability engine\n');

    process.exit(0);
  } catch (error) {
    console.log('❌ FAILED!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    if (error.message.includes('Missing required')) {
      console.log(error.message);
    } else if (error.code === 'invalid_grant') {
      console.log('🔧 Error: Invalid credentials\n');
      console.log('Possible issues:');
      console.log('1. Private key format is incorrect');
      console.log('2. Service account email doesn\'t match');
      console.log('3. Service account credentials may have been revoked\n');
      console.log('Solution:');
      console.log('- Re-run: npm run setup-google');
      console.log('- Verify the private key is wrapped in quotes in .env.local');
      console.log('- Ensure no extra spaces or formatting issues\n');
    } else if (error.code === 404 || error.message.includes('not found')) {
      console.log('🔧 Error: Calendar not found or not accessible\n');
      console.log('Possible issues:');
      console.log('1. Calendar ID is incorrect');
      console.log('2. Calendar not shared with service account\n');
      console.log('Solution:');
      console.log('1. Go to Google Calendar settings');
      console.log('2. Share your calendar with:');
      console.log(`   ${process.env.GOOGLE_CLIENT_EMAIL}`);
      console.log('3. Set permission to "Make changes to events"');
      console.log('4. Verify GOOGLE_CALENDAR_ID in .env.local is correct\n');
    } else if (error.message.includes('API has not been used')) {
      console.log('🔧 Error: Google Calendar API not enabled\n');
      console.log('Solution:');
      console.log('1. Go to Google Cloud Console');
      console.log('2. Navigate to "APIs & Services" → "Library"');
      console.log('3. Search for "Google Calendar API"');
      console.log('4. Click "Enable"\n');
    } else {
      console.log('🔧 Unexpected Error:\n');
      console.log(error.message);
      if (error.stack) {
        console.log('\nStack trace:');
        console.log(error.stack);
      }
      console.log('\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🆘 Need help?');
    console.log('1. Double-check all environment variables in .env.local');
    console.log('2. Verify calendar sharing settings');
    console.log('3. Ensure Google Calendar API is enabled');
    console.log('4. Review the service account setup steps\n');
    
    process.exit(1);
  }
}

testConnection();
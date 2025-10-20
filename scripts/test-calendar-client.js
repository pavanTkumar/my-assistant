/**
 * Direct Calendar Client Test
 * Tests Google Calendar integration without TypeScript imports
 */

require('dotenv').config({ path: '.env' });
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const { Redis } = require('@upstash/redis');

async function test() {
  console.log('🧪 Testing Calendar Client Integration...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // ==================================================================
    // STEP 1: Verify Environment Variables
    // ==================================================================
    console.log('1️⃣  Checking environment variables...\n');

    const requiredVars = {
      'GOOGLE_CLIENT_EMAIL': process.env.GOOGLE_CLIENT_EMAIL,
      'GOOGLE_PRIVATE_KEY': process.env.GOOGLE_PRIVATE_KEY,
      'GOOGLE_CALENDAR_ID': process.env.GOOGLE_CALENDAR_ID,
      'REDIS_URL': process.env.REDIS_URL,
      'REDIS_TOKEN': process.env.REDIS_TOKEN,
    };

    let missingVars = [];
    for (const [key, value] of Object.entries(requiredVars)) {
      if (!value) {
        missingVars.push(key);
        console.log(`   ✗ ${key}: Missing`);
      } else {
        console.log(`   ✓ ${key}: Found`);
      }
    }

    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    console.log('\n✅ All environment variables found\n');

    // ==================================================================
    // STEP 2: Initialize Google Calendar Client
    // ==================================================================
    console.log('2️⃣  Initializing Google Calendar client...\n');

    const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

    const jwtClient = new JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: privateKey,
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ],
    });

    await jwtClient.authorize();
    console.log('   ✓ JWT authorization successful\n');

    const calendar = google.calendar({
      version: 'v3',
      auth: jwtClient,
    });

    console.log('✅ Google Calendar client initialized\n');

    // ==================================================================
    // STEP 3: Test Calendar Access
    // ==================================================================
    console.log('3️⃣  Testing calendar access...\n');

    const calendarInfo = await calendar.calendars.get({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
    });

    console.log(`   ✓ Calendar found: ${calendarInfo.data.summary}`);
    console.log(`   ✓ Timezone: ${calendarInfo.data.timeZone}\n`);

    console.log('✅ Calendar access verified\n');

    // ==================================================================
    // STEP 4: Query Free/Busy Information
    // ==================================================================
    console.log('4️⃣  Querying free/busy information...\n');

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);

    console.log(`   Date range: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`);

    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        timeZone: 'Asia/Kolkata',
        items: [{ id: process.env.GOOGLE_CALENDAR_ID }],
      },
    });

    const busySlots = freeBusyResponse.data.calendars?.[process.env.GOOGLE_CALENDAR_ID]?.busy || [];

    console.log(`   ✓ Query successful`);
    console.log(`   ✓ Busy periods found: ${busySlots.length}\n`);

    if (busySlots.length > 0) {
      console.log('   📋 Busy periods (first 5):\n');
      busySlots.slice(0, 5).forEach((slot, i) => {
        const start = new Date(slot.start).toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        const end = new Date(slot.end).toLocaleString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        console.log(`      ${i + 1}. ${start} - ${end}`);
      });
      if (busySlots.length > 5) {
        console.log(`      ... and ${busySlots.length - 5} more\n`);
      } else {
        console.log('');
      }
    } else {
      console.log('   ✨ No busy periods - calendar is completely free!\n');
    }

    console.log('✅ Free/busy query working\n');

    // ==================================================================
    // STEP 5: Test Redis Caching
    // ==================================================================
    console.log('5️⃣  Testing Redis caching...\n');

    const redis = new Redis({
      url: process.env.REDIS_URL,
      token: process.env.REDIS_TOKEN,
    });

    const cacheKey = `test:calendar:${startDate.toISOString().split('T')[0]}`;
    const cacheData = {
      busyPeriods: busySlots.length,
      queriedAt: new Date().toISOString(),
    };

    await redis.setex(cacheKey, 300, JSON.stringify(cacheData));
    console.log(`   ✓ Cache write successful (key: ${cacheKey})`);

    const cached = await redis.get(cacheKey);
    console.log(`   ✓ Cache read successful`);

    await redis.del(cacheKey);
    console.log(`   ✓ Cache cleanup successful\n`);

    console.log('✅ Redis caching working\n');

    // ==================================================================
    // SUMMARY
    // ==================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🎉 ALL TESTS PASSED!\n');
    console.log('📊 Summary:');
    console.log(`   ✅ Environment variables configured`);
    console.log(`   ✅ Google Calendar authenticated`);
    console.log(`   ✅ Calendar access verified`);
    console.log(`   ✅ Free/busy queries working`);
    console.log(`   ✅ Redis caching operational`);
    console.log(`   ✅ Found ${busySlots.length} busy periods in next 7 days`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🚀 Ready to proceed with:');
    console.log('   • Step 3.3: Slot Generator');
    console.log('   • Step 3.4: Slot Ranker');
    console.log('   • Step 3.5: Availability Engine\n');

    process.exit(0);
  } catch (error) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('❌ TEST FAILED!\n');
    console.error('Error:', error.message);

    if (error.message.includes('invalid_grant') || error.message.includes('unauthorized')) {
      console.log('\n🔧 Google Calendar Authentication Issue:');
      console.log('1. Verify GOOGLE_PRIVATE_KEY is correct in .env');
      console.log('2. Check that private key has no extra spaces');
      console.log('3. Ensure service account has calendar access');
      console.log('4. Run: npm run test-calendar\n');
    }

    if (error.message.includes('404') || error.message.includes('not found')) {
      console.log('\n🔧 Calendar Not Found:');
      console.log('1. Verify GOOGLE_CALENDAR_ID in .env');
      console.log('2. Ensure calendar is shared with service account');
      console.log('3. Check service account email in Google Calendar sharing settings\n');
    }

    if (error.message.includes('Redis') || error.message.includes('Upstash')) {
      console.log('\n🔧 Redis Connection Issue:');
      console.log('1. Verify REDIS_URL and REDIS_TOKEN in .env');
      console.log('2. Check Upstash dashboard');
      console.log('3. Run: npm run test-redis\n');
    }

    console.log('Full error:');
    console.error(error);
    console.log('');

    process.exit(1);
  }
}

test();
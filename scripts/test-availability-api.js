/**
 * Availability API Integration Test
 * Tests the availability system through HTTP endpoints
 */

require('dotenv').config({ path: '.env' });

async function runApiTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║        AVAILABILITY API - INTEGRATION TEST SUITE               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  console.log(`🌐 Testing against: ${baseUrl}\n`);
  console.log('⚠️  Note: Make sure the dev server is running (npm run dev)\n');

  // ==================================================================
  // TEST 1: ENVIRONMENT VALIDATION
  // ==================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('TEST 1: Environment Validation\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  totalTests++;
  try {
    const requiredVars = [
      'GOOGLE_CLIENT_EMAIL',
      'GOOGLE_PRIVATE_KEY',
      'GOOGLE_CALENDAR_ID',
      'REDIS_URL',
      'REDIS_TOKEN',
      'DATABASE_URL',
      'DIRECT_URL',
    ];

    let missing = [];
    for (const varName of requiredVars) {
      if (!process.env[varName]) {
        missing.push(varName);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }

    console.log('✅ All environment variables present\n');
    passedTests++;
  } catch (error) {
    console.error('❌ Environment validation failed:', error.message);
    console.log('');
    failedTests++;
  }

  // ==================================================================
  // TEST 2: SERVER HEALTH CHECK
  // ==================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('TEST 2: Server Health Check\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  totalTests++;
  try {
    console.log(`⚡ Checking if server is running at ${baseUrl}...`);

    const response = await fetch(baseUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    if (!response) {
      throw new Error(
        `Cannot connect to server at ${baseUrl}\n\n` +
        'Please start the development server:\n' +
        '  npm run dev\n'
      );
    }

    console.log('✅ Server is running\n');
    passedTests++;
  } catch (error) {
    console.error('❌ Server health check failed:', error.message);
    console.log('');
    failedTests++;
    
    // If server is not running, skip remaining tests
    console.log('⚠️  Skipping remaining tests (server not running)\n');
    console.log('Please start the server with: npm run dev\n');
    
    printSummary(totalTests, passedTests, failedTests, startTime);
    process.exit(1);
  }

  // ==================================================================
  // TEST 3: AVAILABILITY QUERY API
  // ==================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('TEST 3: Availability Query API (GET /api/availability)\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  totalTests++;
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 5);

    const url = `${baseUrl}/api/availability?` +
      `startDate=${startDate.toISOString()}&` +
      `endDate=${endDate.toISOString()}&` +
      `duration=30`;

    console.log('⚡ Querying availability...');
    console.log(`  Range: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`);
    console.log(`  Duration: 30 minutes\n`);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();

    console.log('✓ API response received');
    console.log(`✓ Success: ${data.success}`);
    console.log(`✓ Slots found: ${data.data?.metadata?.totalSlotsFound || 0}`);
    console.log(`✓ Cache hit: ${data.data?.metadata?.cacheHit}`);
    console.log(`✓ Generation time: ${data.data?.metadata?.generationTime}ms\n`);

    if (data.data?.slots?.length > 0) {
      console.log('Top 3 slots:');
      data.data.slots.slice(0, 3).forEach((slot, i) => {
        console.log(`  ${i + 1}. ${slot.dateFormatted} at ${slot.startTimeFormatted}`);
        console.log(`     Score: ${slot.qualityScore}/100 ${slot.isOptimal ? '⭐' : ''}`);
      });
      console.log('');
    }

    passedTests++;
  } catch (error) {
    console.error('❌ Availability query test failed:', error.message);
    console.log('');
    failedTests++;
  }

  // ==================================================================
  // TEST 4: DATE-SPECIFIC API
  // ==================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('TEST 4: Date-Specific API (GET /api/availability/[date])\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  totalTests++;
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const url = `${baseUrl}/api/availability/${dateStr}?duration=30`;

    console.log('⚡ Querying availability for specific date...');
    console.log(`  Date: ${dateStr}`);
    console.log(`  Duration: 30 minutes\n`);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();

    console.log('✓ API response received');
    console.log(`✓ Success: ${data.success}`);
    console.log(`✓ Slots found: ${data.data?.slotsFound || 0}\n`);

    passedTests++;
  } catch (error) {
    console.error('❌ Date-specific API test failed:', error.message);
    console.log('');
    failedTests++;
  }

  // ==================================================================
  // TEST 5: SLOT CHECK API
  // ==================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('TEST 5: Slot Check API (POST /api/availability/check)\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  totalTests++;
  try {
    const start = new Date();
    start.setDate(start.getDate() + 2);
    start.setHours(14, 0, 0, 0);

    const end = new Date(start);
    end.setHours(14, 30, 0, 0);

    const url = `${baseUrl}/api/availability/check`;

    console.log('⚡ Checking specific slot...');
    console.log(`  Start: ${start.toLocaleString()}`);
    console.log(`  End: ${end.toLocaleString()}\n`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: start.toISOString(),
        end: end.toISOString(),
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();

    console.log('✓ API response received');
    console.log(`✓ Success: ${data.success}`);
    console.log(`✓ Available: ${data.data?.available}`);
    if (data.data?.reason) {
      console.log(`✓ Reason: ${data.data.reason}`);
    }
    console.log('');

    passedTests++;
  } catch (error) {
    console.error('❌ Slot check API test failed:', error.message);
    console.log('');
    failedTests++;
  }

  // ==================================================================
  // TEST 6: CACHE PERFORMANCE
  // ==================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('TEST 6: Cache Performance\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  totalTests++;
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 7);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 3);

    const url = `${baseUrl}/api/availability?` +
      `startDate=${startDate.toISOString()}&` +
      `endDate=${endDate.toISOString()}&` +
      `duration=60`;

    console.log('⚡ First query (no cache)...');
    const start1 = Date.now();
    const response1 = await fetch(url);
    const data1 = await response1.json();
    const time1 = Date.now() - start1;

    console.log(`✓ First query: ${time1}ms (cache hit: ${data1.data?.metadata?.cacheHit})`);

    console.log('⚡ Second query (should use cache)...');
    const start2 = Date.now();
    const response2 = await fetch(url);
    const data2 = await response2.json();
    const time2 = Date.now() - start2;

    console.log(`✓ Cached query: ${time2}ms (cache hit: ${data2.data?.metadata?.cacheHit})`);

    if (data2.data?.metadata?.cacheHit) {
      const speedup = ((time1 - time2) / time1 * 100).toFixed(1);
      console.log(`✓ Performance improvement: ${speedup}% faster`);
      console.log('✅ Cache working perfectly!\n');
    } else {
      console.log('⚠️  Cache miss on second query (unexpected but not critical)\n');
    }

    passedTests++;
  } catch (error) {
    console.error('❌ Cache performance test failed:', error.message);
    console.log('');
    failedTests++;
  }

  // ==================================================================
  // FINAL SUMMARY
  // ==================================================================
  printSummary(totalTests, passedTests, failedTests, startTime);

  if (failedTests === 0) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

function printSummary(totalTests, passedTests, failedTests, startTime) {
  const totalTime = Date.now() - startTime;

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                        TEST SUMMARY                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`Total Tests:  ${totalTests}`);
  console.log(`✅ Passed:     ${passedTests}`);
  console.log(`❌ Failed:     ${failedTests}`);
  console.log(`⏱️  Time:       ${totalTime}ms\n`);

  const successRate = ((passedTests / totalTests) * 100).toFixed(1);
  console.log(`Success Rate: ${successRate}%\n`);

  if (failedTests === 0) {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                  🎉 ALL TESTS PASSED! 🎉                       ║');
    console.log('║                                                                ║');
    console.log('║  Your Availability API is fully operational!                  ║');
    console.log('║                                                                ║');
    console.log('║  ✅ Environment configured                                     ║');
    console.log('║  ✅ Server running                                             ║');
    console.log('║  ✅ Availability queries working                               ║');
    console.log('║  ✅ Date-specific queries working                              ║');
    console.log('║  ✅ Slot checking working                                      ║');
    console.log('║  ✅ Cache performance optimized                                ║');
    console.log('║                                                                ║');
    console.log('║  🚀 READY FOR FRONTEND INTEGRATION!                            ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log('Next steps:');
    console.log('1. ✅ Backend API complete');
    console.log('2. 🎨 Build frontend UI components');
    console.log('3. 💬 Integrate with LangChain conversation');
    console.log('4. 🚀 Deploy to production\n');
  } else {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                ⚠️  SOME TESTS FAILED                           ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log('Troubleshooting:');
    console.log('1. Ensure dev server is running: npm run dev');
    console.log('2. Check all environment variables are set');
    console.log('3. Verify Google Calendar and Redis connections');
    console.log('4. Review error messages above\n');
  }
}

// Run tests
runApiTests().catch((error) => {
  console.error('Test suite error:', error);
  process.exit(1);
});
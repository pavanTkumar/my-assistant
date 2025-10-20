/**
 * Test Redis Connection
 */

const { Redis } = require('@upstash/redis');
require('dotenv').config({ path: '.env' });

async function testRedis() {
  console.log('\n🔍 Testing Redis Connection...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Check environment variables
    const redisUrl = process.env.REDIS_URL;
    const redisToken = process.env.REDIS_TOKEN;

    if (!redisUrl || !redisToken) {
      throw new Error(
        '❌ Missing Redis credentials!\n\n' +
        'Please add to .env:\n' +
        '  REDIS_URL=https://your-redis.upstash.io\n' +
        '  REDIS_TOKEN=your_token_here\n'
      );
    }

    console.log('✓ Environment variables found');
    console.log(`  Redis URL: ${redisUrl.substring(0, 30)}...`);
    console.log('');

    // Initialize Redis client
    console.log('⚙️  Initializing Redis client...');
    const redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });

    // Test write
    console.log('📝 Testing write operation...');
    await redis.set('test:connection', 'success', { ex: 60 });
    console.log('✓ Write successful\n');

    // Test read
    console.log('📖 Testing read operation...');
    const value = await redis.get('test:connection');
    console.log(`✓ Read successful: "${value}"\n`);

    // Test delete
    console.log('🗑️  Testing delete operation...');
    await redis.del('test:connection');
    console.log('✓ Delete successful\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('✅ SUCCESS!');
    console.log('🔥 Redis connection is working perfectly!\n');
    console.log('Next steps:');
    console.log('1. ✅ Database setup complete');
    console.log('2. ✅ Redis setup complete');
    console.log('3. 🚀 Ready for Step 3: Smart Availability Engine\n');

    process.exit(0);
  } catch (error) {
    console.log('❌ FAILED!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Error:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Verify REDIS_URL and REDIS_TOKEN in .env');
    console.log('2. Check Upstash dashboard - is database running?');
    console.log('3. Ensure no typos in credentials');
    console.log('4. Try recreating the database\n');
    process.exit(1);
  }
}

testRedis();
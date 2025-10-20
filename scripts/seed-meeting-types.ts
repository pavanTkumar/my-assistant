/**
 * Seed default meeting types
 * Uses direct database connection (not Accelerate)
 */

import { PrismaClient } from '@prisma/client';

// Use direct URL for seeding (bypass Accelerate)
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL,
    },
  },
});

async function main() {
  console.log('🌱 Seeding meeting types...\n');
  console.log('Using direct database connection (bypassing Accelerate)...\n');

  const meetingTypes = [
    {
      name: 'Quick Call',
      description: '15-minute quick discussion or consultation',
      duration: 15,
      color: '#3B82F6',
      bufferBefore: 5,
      bufferAfter: 5,
      minAdvanceNotice: 120, // 2 hours
      maxAdvanceBooking: 14, // 2 weeks
    },
    {
      name: 'Consultation',
      description: '30-minute consultation session',
      duration: 30,
      color: '#10B981',
      bufferBefore: 10,
      bufferAfter: 10,
      minAdvanceNotice: 240, // 4 hours
      maxAdvanceBooking: 30, // 1 month
    },
    {
      name: 'Interview',
      description: '1-hour technical or general interview',
      duration: 60,
      color: '#F59E0B',
      bufferBefore: 15,
      bufferAfter: 15,
      minAdvanceNotice: 1440, // 24 hours
      maxAdvanceBooking: 60, // 2 months
    },
    {
      name: 'Deep Dive',
      description: '2-hour in-depth discussion or workshop',
      duration: 120,
      color: '#8B5CF6',
      bufferBefore: 15,
      bufferAfter: 30,
      minAdvanceNotice: 2880, // 48 hours
      maxAdvanceBooking: 90, // 3 months
    },
  ];

  let successCount = 0;
  let errorCount = 0;

  for (const type of meetingTypes) {
    try {
      const created = await prisma.meetingType.upsert({
        where: { name: type.name },
        update: type,
        create: type,
      });
      console.log(`✓ Created: ${created.name} (${created.duration} min)`);
      successCount++;
    } catch (error) {
      console.error(`✗ Failed to create: ${type.name}`, error);
      errorCount++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ❌ Failed: ${errorCount}`);
  console.log('\n✅ Meeting types seeding complete!');
}

main()
  .catch((e) => {
    console.error('\n❌ Error seeding database:', e.message);
    console.error('\nTroubleshooting:');
    console.error('1. Verify DIRECT_URL is set in .env');
    console.error('2. Check database connection is working');
    console.error('3. Ensure database schema was pushed successfully\n');
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
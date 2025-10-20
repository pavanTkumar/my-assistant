/**
 * Setup Script: Convert Google Service Account JSON to Environment Variables
 * 
 * Usage: node scripts/setup-google-credentials.js
 * 
 * This script reads the google-service-account.json file and outputs
 * the formatted environment variables for .env.local
 */

const fs = require('fs');
const path = require('path');

function setupCredentials() {
  const jsonPath = path.join(process.cwd(), 'google-service-account.json');

  // Check if file exists
  if (!fs.existsSync(jsonPath)) {
    console.error('❌ Error: google-service-account.json not found!');
    console.log('\nPlease:');
    console.log('1. Download your JSON key from Google Cloud Console');
    console.log('2. Rename it to "google-service-account.json"');
    console.log('3. Place it in the root directory of this project');
    console.log('4. Run this script again');
    process.exit(1);
  }

  try {
    // Read and parse JSON
    const jsonContent = fs.readFileSync(jsonPath, 'utf8');
    const credentials = JSON.parse(jsonContent);

    // Extract required fields
    const {
      client_email,
      private_key,
      project_id,
    } = credentials;

    // Validate fields
    if (!client_email || !private_key || !project_id) {
      throw new Error('JSON file is missing required fields');
    }

    // Format output
    console.log('\n✅ Successfully read credentials!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 Add these to your .env.local file:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('# Google Calendar Service Account');
    console.log(`GOOGLE_CLIENT_EMAIL=${client_email}`);
    console.log(`GOOGLE_PRIVATE_KEY="${private_key}"`);
    console.log('GOOGLE_CALENDAR_ID=YOUR_EMAIL@gmail.com  # Replace with your calendar ID');
    console.log(`GOOGLE_PROJECT_ID=${project_id}`);
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🔒 SECURITY REMINDER:');
    console.log('1. Never commit google-service-account.json to git');
    console.log('2. Add it to .gitignore immediately');
    console.log('3. Delete the JSON file after copying to .env.local');
    console.log('4. Keep .env.local secure and never commit it');
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('✨ Next steps:');
    console.log('1. Copy the variables above to .env.local');
    console.log('2. Replace GOOGLE_CALENDAR_ID with your actual calendar ID');
    console.log('3. Delete google-service-account.json');
    console.log('4. Run: npm run test-calendar\n');

  } catch (error) {
    console.error('❌ Error parsing JSON file:', error.message);
    process.exit(1);
  }
}

setupCredentials();
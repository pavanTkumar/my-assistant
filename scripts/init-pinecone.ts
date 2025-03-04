import * as path from 'path';
import * as fs from 'fs';
import { seedPineconeWithData } from '../src/lib/pinecone';

// Manual env loading since dotenv is causing issues
function loadEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        process.env[key] = value;
      }
    });
    
    console.log('Environment variables loaded from .env.local');
  } catch (error) {
    console.warn('Could not load .env.local file:', error);
  }
}

async function main() {
  // Load environment variables
  loadEnv();
  
  console.log('Starting Pinecone initialization...');
  
  try {
    console.log('Seeding Pinecone vector database with data about Pavan Tejavath...');
    const result = await seedPineconeWithData();
    
    if (result) {
      console.log('✅ Successfully seeded Pinecone with data!');
    } else {
      console.error('❌ Failed to seed Pinecone with data.');
    }
  } catch (error) {
    console.error('Error initializing Pinecone:', error);
    process.exit(1);
  }
}

// Run the main function
main()
  .then(() => {
    console.log('Initialization complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Initialization failed:', error);
    process.exit(1);
  });
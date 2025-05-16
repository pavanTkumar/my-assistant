// scripts/upload-to-pinecone.cjs

const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local manually
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        process.env[key] = value;
      }
    });
    console.log('Environment variables loaded from .env.local');
  }
} catch (error) {
  console.warn('Could not load .env.local file:', error);
}

// Import pinecone module using require
// Note: we're importing the compiled JS file, not the TS file
let pinecone;
try {
  // First try the production build path
  pinecone = require('../.next/server/app/lib/pinecone');
} catch (error) {
  try {
    // Fallback to direct TS file (this works if you have ts-node properly configured)
    pinecone = require('../src/lib/pinecone');
  } catch (innerError) {
    console.error('Error importing pinecone module:', innerError);
    console.log('You may need to build your project first with "npm run build"');
    console.log('Or ensure your pinecone.ts file is properly accessible');
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node scripts/upload-to-pinecone.cjs <file.txt>');
    console.log('  node scripts/upload-to-pinecone.cjs <file.txt> <document_type>');
    console.log('\nExample:');
    console.log('  node scripts/upload-to-pinecone.cjs my-bio.txt bio');
    console.log('  node scripts/upload-to-pinecone.cjs my-services.txt services');
    return;
  }
  
  const filePath = args[0];
  // Optional document type (defaults to "document")
  const docType = args[1] || "document";
  
  console.log(`Uploading file: ${filePath}`);
  console.log(`Document type: ${docType}`);
  
  try {
    // Handle directory vs single file
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      // Read all .txt files from directory
      const files = fs.readdirSync(filePath)
        .filter(file => file.endsWith('.txt'))
        .map(file => path.join(filePath, file));
        
      console.log(`Found ${files.length} .txt files in directory.`);
      
      let successCount = 0;
      let failCount = 0;
      
      // Process each file
      for (const file of files) {
        const result = await pinecone.uploadFileToVectorDB(file, docType);
        console.log(`${file}: ${result.message}`);
        
        if (result.success) successCount++;
        else failCount++;
      }
      
      console.log(`\nSummary: Processed ${files.length} files`);
      console.log(`  Success: ${successCount}`);
      console.log(`  Failed: ${failCount}`);
      
    } else {
      // Process single file
      const result = await pinecone.uploadFileToVectorDB(filePath, docType);
      console.log(result.message);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
  }
}

main().catch(console.error);
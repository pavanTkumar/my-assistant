// scripts/upload-to-pinecone.ts

import { uploadFileToVectorDB } from '../src/lib/pinecone';
import path from 'path';
import fs from 'fs';

// Load environment variables from .env.local manually
// (This avoids the dotenv dependency)
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

const main = async () => {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  npx ts-node scripts/upload-to-pinecone.ts <file.txt>');
    console.log('  npx ts-node scripts/upload-to-pinecone.ts <file.txt> <document_type>');
    console.log('\nExample:');
    console.log('  npx ts-node scripts/upload-to-pinecone.ts my-bio.txt bio');
    console.log('  npx ts-node scripts/upload-to-pinecone.ts my-services.txt services');
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
        const result = await uploadFileToVectorDB(file, docType);
        console.log(`${file}: ${result.message}`);
        
        if (result.success) successCount++;
        else failCount++;
      }
      
      console.log(`\nSummary: Processed ${files.length} files`);
      console.log(`  Success: ${successCount}`);
      console.log(`  Failed: ${failCount}`);
      
    } else {
      // Process single file
      const result = await uploadFileToVectorDB(filePath, docType);
      console.log(result.message);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
  }
};

main().catch(console.error);
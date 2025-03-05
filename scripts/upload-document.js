// scripts/upload-document.js

const fs = require('fs');
const path = require('path');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { Pinecone } = require('@pinecone-database/pinecone');

// Load environment variables from .env.local
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

// Initialize Pinecone
async function initPinecone() {
  const config = {
    apiKey: process.env.PINECONE_API_KEY || '',
  };
  
  // Add environment if it exists
  if (process.env.PINECONE_ENVIRONMENT) {
    config.environment = process.env.PINECONE_ENVIRONMENT;
  }
  
  return new Pinecone(config);
}

// Get Pinecone index
async function getPineconeIndex() {
  const pinecone = await initPinecone();
  return pinecone.index(process.env.PINECONE_INDEX || '');
}

// Add document to vector database
async function addDocument(text, metadata = {}) {
  try {
    const index = await getPineconeIndex();
    const openAIEmbeddings = new OpenAIEmbeddings({ 
      openAIApiKey: process.env.OPENAI_API_KEY 
    });
    
    // Generate embedding for the text
    const embedding = await openAIEmbeddings.embedDocuments([text]);
    
    // Create a unique ID for the document
    const id = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    // Upsert the document to Pinecone
    await index.upsert([
      {
        id,
        values: embedding[0],
        metadata: {
          ...metadata,
          text,
        },
      },
    ]);
    
    return { success: true };
  } catch (error) {
    console.error('Error adding document to vector store:', error);
    return { success: false, error };
  }
}

// Upload a text file to Pinecone
async function uploadFileToVectorDB(filePath, type = 'document') {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return { 
        success: false, 
        message: `File not found: ${filePath}` 
      };
    }
    
    // Read the file content
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Get filename for metadata
    const filename = filePath.split('/').pop() || filePath;
    
    // Create metadata
    const metadata = {
      type,
      source: filename,
      uploadDate: new Date().toISOString()
    };
    
    // Split content into chunks if it's very large (over 4000 chars)
    if (content.length > 4000) {
      // Simple chunk splitting (for very large texts)
      const chunks = [];
      let i = 0;
      while (i < content.length) {
        chunks.push(content.slice(i, i + 4000));
        i += 3800; // Overlapping chunks for better context preservation
      }
      
      // Upload each chunk
      let chunkCount = 0;
      for (let i = 0; i < chunks.length; i++) {
        const result = await addDocument(chunks[i], {
          ...metadata,
          chunk: i + 1,
          totalChunks: chunks.length
        });
        
        if (result.success) {
          chunkCount++;
        }
      }
      
      return { 
        success: true, 
        message: `Successfully uploaded file. Split into ${chunkCount} chunks.` 
      };
    } else {
      // Upload as single document if it's small
      const result = await addDocument(content, metadata);
      
      if (result.success) {
        return { 
          success: true, 
          message: 'Successfully uploaded file.' 
        };
      } else {
        throw result.error;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Error uploading file: ${errorMessage}`
    };
  }
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node scripts/upload-document.js <file.txt>');
    console.log('  node scripts/upload-document.js <file.txt> <document_type>');
    console.log('\nExample:');
    console.log('  node scripts/upload-document.js my-bio.txt bio');
    console.log('  node scripts/upload-document.js my-services.txt services');
    return;
  }
  
  const filePath = args[0];
  // Optional document type (defaults to "document")
  const docType = args[1] || "document";
  
  console.log(`Uploading file: ${filePath}`);
  console.log(`Document type: ${docType}`);
  
  try {
    // Check for required environment variables
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is missing from environment variables');
    }
    
    if (!process.env.PINECONE_API_KEY) {
      throw new Error('PINECONE_API_KEY is missing from environment variables');
    }
    
    if (!process.env.PINECONE_INDEX) {
      throw new Error('PINECONE_INDEX is missing from environment variables');
    }
    
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
}

main().catch(console.error);
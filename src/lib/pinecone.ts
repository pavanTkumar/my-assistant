import { Pinecone, Index } from '@pinecone-database/pinecone';
import { Document } from 'langchain/document';
import { OpenAIEmbeddings } from '@langchain/openai';
import fs from 'fs';

// Initialize Pinecone client
let pineconeClient: Pinecone | null = null;

export const initPinecone = async (): Promise<Pinecone> => {
  if (!pineconeClient) {
    // Create config and add environment if needed for deployment
    const config: any = {
      apiKey: process.env.PINECONE_API_KEY || ''
    };
    
    pineconeClient = new Pinecone(config);
  }
  return pineconeClient;
};

// Get Pinecone index
export const getPineconeIndex = async (): Promise<Index> => {
  const pinecone = await initPinecone();
  return pinecone.index(process.env.PINECONE_INDEX || '');
};

// Add document to vector database
export const addDocument = async (
  text: string,
  metadata: Record<string, any> = {}
): Promise<number> => {
  try {
    const index = await getPineconeIndex();
    const openAIEmbeddings = new OpenAIEmbeddings({ openAIApiKey: process.env.OPENAI_API_KEY });
    
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
    
    return 1; // Return the number of chunks inserted
  } catch (error) {
    console.error('Error adding document to vector store:', error);
    throw error;
  }
};

// Search for similar documents
export const similaritySearch = async (
  query: string,
  k: number = 3
): Promise<Document[]> => {
  try {
    const index = await getPineconeIndex();
    const openAIEmbeddings = new OpenAIEmbeddings({ openAIApiKey: process.env.OPENAI_API_KEY });
    
    // Generate embedding for the query
    const embedding = await openAIEmbeddings.embedQuery(query);
    
    // Query Pinecone
    const results = await index.query({
      vector: embedding,
      topK: k,
      includeMetadata: true,
    });
    
    // Convert Pinecone results to LangChain Document format
    return results.matches.map((match) => {
      return {
        pageContent: match.metadata?.text as string || '',
        metadata: { ...match.metadata },
      };
    });
  } catch (error) {
    console.error('Error searching vector store:', error);
    return [];
  }
};

// NEW FUNCTION: Upload a text file to Pinecone
export const uploadFileToVectorDB = async (
  filePath: string,
  type: string = 'document'
): Promise<{success: boolean; message: string}> => {
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
        await addDocument(chunks[i], {
          ...metadata,
          chunk: i + 1,
          totalChunks: chunks.length
        });
        chunkCount++;
      }
      
      return { 
        success: true, 
        message: `Successfully uploaded file. Split into ${chunkCount} chunks.` 
      };
    } else {
      // Upload as single document if it's small
      await addDocument(content, metadata);
      return { 
        success: true, 
        message: 'Successfully uploaded file.' 
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Error uploading file: ${errorMessage}`
    };
  }
};

// Initialize Pinecone with seed data about Pavan
export const seedPineconeWithData = async (): Promise<boolean> => {
  try {
    // Example data about Pavan
    const bioData = `
      Pavan Tejavath is a technology professional specializing in artificial intelligence and 
      software development. With extensive experience in building intelligent systems, he focuses 
      on creating solutions that leverage the latest advancements in AI.
      
      Pavan offers consulting services for businesses looking to implement AI solutions, 
      develop custom software, or enhance their existing technology stack.
      
      His expertise includes machine learning, natural language processing, and cloud-based 
      solutions. Pavan is passionate about helping businesses transform their operations 
      through intelligent automation.
    `;
    
    const servicesData = `
      Services offered by Pavan Tejavath:
      
      1. AI Consulting: Strategic guidance on implementing artificial intelligence in business processes.
      
      2. Custom Software Development: Building tailored applications to meet specific business needs.
      
      3. Machine Learning Solutions: Developing predictive models and data-driven systems.
      
      4. Natural Language Processing: Creating conversational AI and text analysis systems.
      
      5. Cloud Architecture: Designing scalable and secure cloud infrastructure.
      
      6. Technology Training: Workshops and training programs on AI and software development.
    `;
    
    const contactInfo = `
      To contact Pavan Tejavath:
      
      Email: pavan@thetejavath.com
      Website: https://thetejavath.com
      
      For appointments: Use the booking system on the website to schedule a meeting.
      For urgent matters: Send a message marked as urgent through the website.
      
      Pavan typically responds to inquiries within 24-48 hours.
    `;
    
    // Add each document
    await addDocument(bioData, { type: 'bio', title: 'About Pavan Tejavath' });
    await addDocument(servicesData, { type: 'services', title: 'Services Offered' });
    await addDocument(contactInfo, { type: 'contact', title: 'Contact Information' });
    
    return true;
  } catch (error) {
    console.error('Error seeding Pinecone:', error);
    return false;
  }
};
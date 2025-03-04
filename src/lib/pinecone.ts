import { Pinecone, Index } from '@pinecone-database/pinecone';
import { Document } from 'langchain/document';
import { OpenAIEmbeddings } from '@langchain/openai';

// Initialize Pinecone client
let pineconeClient: Pinecone | null = null;

export const initPinecone = async (): Promise<Pinecone> => {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY || '',
      environment: process.env.PINECONE_ENVIRONMENT || '' // Add back the environment property
    });
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
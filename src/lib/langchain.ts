import { ChatOpenAI } from '@langchain/openai';
import { similaritySearch } from './pinecone';
import { Document } from 'langchain/document';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

// Initialize OpenAI Chat Model
const model = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: 'gpt-4o-mini', 
  temperature: 0.7,
});

// Generate a response using RAG
export const generateRagResponse = async (question: string): Promise<string> => {
  try {
    // Search for relevant documents
    const docs = await similaritySearch(question);
    // If no documents found, use a generic response
    if (docs.length === 0) {
      return await generateGenericResponse(question);
    }
    // Combine document content
    const context = docs.map((doc) => doc.pageContent).join('\n\n');
    // Generate response with context using direct model call instead of chain
    const response = await model.invoke([
      new SystemMessage(`You are Pavan Tejavath's AI assistant. You are helpful, friendly, and informative.
Answer the user's question based on the following context information.
If the question cannot be answered based on the context, just say you don't know
rather than making up an answer.
Context:
${context}`),
      new HumanMessage(question)
    ]);
    return response.content.toString();
  } catch (error) {
    console.error('Error generating RAG response:', error);
    return "I'm sorry, I encountered an error processing your request. Please try again.";
  }
};

// Generate a generic response
export const generateGenericResponse = async (query: string): Promise<string> => {
  try {
    const response = await model.invoke([
      new SystemMessage(`You are Pavan Tejavath's AI assistant. You are helpful, friendly, and informative.
Respond to the user's query to the best of your ability.
If the user is asking for specific information about Pavan Tejavath that you don't have,
you can suggest that they book an appointment or send him a message directly.`),
      new HumanMessage(query)
    ]);
    return response.content.toString();
  } catch (error) {
    console.error('Error generating generic response:', error);
    return "I'm sorry, I encountered an error processing your request. Please try again.";
  }
};

// Determine if a query is about appointments
export const isAppointmentQuery = (query: string): boolean => {
  const appointmentKeywords = [
    'appointment', 'schedule', 'book', 'meet', 'meeting',
    'availability', 'available', 'time', 'slot', 'calendar'
  ];
  const lowerQuery = query.toLowerCase();
  return appointmentKeywords.some(keyword => lowerQuery.includes(keyword));
};

// Determine if a query is about contacting Pavan
export const isContactQuery = (query: string): boolean => {
  const contactKeywords = [
    'contact', 'message', 'email', 'reach', 'call',
    'get in touch', 'talk to', 'speak with', 'send a message'
  ];
  const lowerQuery = query.toLowerCase();
  return contactKeywords.some(keyword => lowerQuery.includes(keyword));
};
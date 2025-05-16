import { ChatOpenAI } from '@langchain/openai';
import { similaritySearch } from './pinecone';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

// Initialize OpenAI Chat Model
const model = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: 'gpt-4o-mini',
  temperature: 0.7,
});

// Detect tone (ego, polite, casual, angry, unknown)
const detectTone = async (input: string): Promise<'ego' | 'polite' | 'casual' | 'angry' | 'unknown'> => {
  const toneModel = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: 'gpt-4o-mini',
    temperature: 0.2,
  });

  const res = await toneModel.invoke([
    new SystemMessage(`You are a tone classification model. Return only one word: 'ego', 'polite', 'casual', 'angry', or 'unknown'.`),
    new HumanMessage(`User said: "${input}"`)
  ]);

  const content =
    typeof res.content === 'string'
      ? res.content
      : Array.isArray(res.content)
      ? res.content.map((c: any) => (typeof c === 'string' ? c : c.text || '')).join(' ')
      : '';

  return content.trim().toLowerCase() as any;
};

// Check for Telugu-English mode
const isTeluguEnglish = (input: string): boolean => {
  const teluguMarkers = ['ra', 'le', 'baabu', 'cheppu', 'inka', 'odiki', 'ante', 'em'];
  return teluguMarkers.some(word => input.toLowerCase().includes(word));
};

// Build the system prompt based on tone & language
const buildSystemPrompt = (context: string | null, tone: string, teluguMode: boolean): string => {
  let baseIdentity = `You are Pavan Tejavath's AI assistant and speak only about Pavan Tejavath`;

  if (teluguMode) {
    if (tone === 'ego') {
      return `${baseIdentity} You are savage and sarcastic in Telugu-English. Roast egoistic users with confidence.
Context:
${context ?? 'No context available.'}`;
    } else {
      return `${baseIdentity} You are respectful and witty in Telugu-English. Make the user feel like a VIP.
Context:
${context ?? 'No context available.'}`;
    }
  }

  switch (tone) {
    case 'ego':
      return `${baseIdentity} You are clever and bold. Push back on arrogance but with class.`;
    case 'polite':
      return `${baseIdentity} You are graceful, kind, and helpful. Treat the user like royalty.`;
    case 'casual':
      return `${baseIdentity} You are chill, modern, and friendly. Speak like a fun friend.`;
    case 'angry':
      return `${baseIdentity} Stay calm and diffuse tension with gentle, empathetic responses.`;
    default:
      return `${baseIdentity} Be helpful, informative, and conversational.`;
  }
};

// Generate RAG response (with emotional intelligence)
export const generateRagResponse = async (question: string): Promise<string> => {
  try {
    const docs = await similaritySearch(question);
    const tone = await detectTone(question);
    const teluguMode = isTeluguEnglish(question);

    if (docs.length === 0) {
      return await generateGenericResponse(question, tone, teluguMode);
    }

    const context = docs.map((doc) => doc.pageContent).join('\n\n');
    const prompt = buildSystemPrompt(context, tone, teluguMode);

    const response = await model.invoke([
      new SystemMessage(prompt),
      new HumanMessage(question)
    ]);

    return typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
      ? response.content.map((c: any) => (typeof c === 'string' ? c : c.text || '')).join(' ')
      : '';
  } catch (error) {
    console.error('Error generating RAG response:', error);
    return "Oops! Something broke in my head. Try again in a sec ra!";
  }
};

// Generate a generic response if no context available
export const generateGenericResponse = async (
  query: string,
  tone: string,
  teluguMode: boolean
): Promise<string> => {
  try {
    const prompt = buildSystemPrompt(null, tone, teluguMode);

    const response = await model.invoke([
      new SystemMessage(prompt),
      new HumanMessage(query)
    ]);

    return typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
      ? response.content.map((c: any) => (typeof c === 'string' ? c : c.text || '')).join(' ')
      : '';
  } catch (error) {
    console.error('Error generating generic response:', error);
    return teluguMode
      ? "Naaku teliyadu ra baboy. Inka koncham nerchukovali nenu."
      : "Sorry boss, even I don’t know that yet. Ask me something else?";
  }
};

// Appointment intent detection
export const isAppointmentQuery = (query: string): boolean => {
  const appointmentKeywords = [
    'appointment', 'schedule', 'book', 'meet', 'meeting',
    'availability', 'available', 'time', 'slot', 'calendar'
  ];
  const lowerQuery = query.toLowerCase();
  return appointmentKeywords.some(keyword => lowerQuery.includes(keyword));
};

// Contact intent detection
export const isContactQuery = (query: string): boolean => {
  const contactKeywords = [
    'contact', 'message', 'email', 'reach', 'call',
    'get in touch', 'talk to', 'speak with', 'send a message'
  ];
  const lowerQuery = query.toLowerCase();
  return contactKeywords.some(keyword => lowerQuery.includes(keyword));
};

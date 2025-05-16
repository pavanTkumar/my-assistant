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

// Build system prompt
const buildSystemPrompt = (context: string, tone: string, isTelugu: boolean): string => {
  const identity = `You are a smart AI assistant created by Pavan Tejavath. You are speaking directly to the user, not to Pavan.`;

  if (isTelugu) {
    if (tone === 'ego') {
      return `${identity} You are savage and sarcastic in Telugu-English. Roast egoistic users with confidence.
Answer using this context only:
${context}`;
    } else {
      return `${identity} You are respectful and witty in Telugu-English. Make the user feel like a VIP.
Answer using this context only:
${context}`;
    }
  }

  switch (tone) {
    case 'ego':
      return `${identity} You are clever and bold. Push back on arrogance but with class.
Answer using this context only:
${context}`;
    case 'polite':
      return `${identity} You are graceful, kind, and helpful. Treat the user like royalty.
Answer using this context only:
${context}`;
    case 'casual':
      return `${identity} You are chill, modern, and friendly. Speak like a fun friend.
Answer using this context only:
${context}`;
    case 'angry':
      return `${identity} Stay calm and diffuse tension with gentle, empathetic responses.
Answer using this context only:
${context}`;
    default:
      return `${identity} Be helpful, informative, and conversational.
Answer using this context only:
${context}`;
  }
};

// Main: Generate RAG-based response (no generic fallback)
export const generateRagResponse = async (question: string): Promise<string> => {
  try {
    const docs = await similaritySearch(question);

    // Only answer if context found
    if (docs.length === 0) {
      const isTelugu = isTeluguEnglish(question);
      return isTelugu
        ? "Naaku teliyani vishayam ra idi. Naa brain lo ledu."
        : "Sorry, I couldn’t find anything in my knowledge for that. Try asking something else I’ve been trained on.";
    }

    const tone = await detectTone(question);
    const isTelugu = isTeluguEnglish(question);
    const context = docs.map((doc) => doc.pageContent).join('\n\n');
    const prompt = buildSystemPrompt(context, tone, isTelugu);

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
    return "Oops! Something broke in my head. Try again in a sec.";
  }
};

// Optional: appointment intent detection
export const isAppointmentQuery = (query: string): boolean => {
  const keywords = ['appointment', 'schedule', 'book', 'meet', 'meeting', 'availability', 'available', 'time', 'slot', 'calendar'];
  return keywords.some((word) => query.toLowerCase().includes(word));
};

// Optional: contact intent detection
export const isContactQuery = (query: string): boolean => {
  const keywords = ['contact', 'message', 'email', 'reach', 'call', 'get in touch', 'talk to', 'speak with', 'send a message'];
  return keywords.some((word) => query.toLowerCase().includes(word));
};

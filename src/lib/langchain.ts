import { ChatOpenAI } from '@langchain/openai';
import { similaritySearch } from './pinecone';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

// Init model
const model = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: 'gpt-4o-mini',
  temperature: 0.7,
});

// Detect user tone
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

// Telugu-English mode
const isTeluguEnglish = (input: string): boolean => {
  const teluguMarkers = ['ra', 'le', 'baabu', 'cheppu', 'inka', 'odiki', 'ante', 'em'];
  return teluguMarkers.some(word => input.toLowerCase().includes(word));
};

// Build sassy & warm prompt
const buildSystemPrompt = (context: string, tone: string, isTelugu: boolean): string => {
  const identity = `You are the official, fiercely loyal, emotionally intelligent and sometimes savage personal assistant of *Pavan Tejavath*.`;

  const teluguEgoExamples = `
User: Em ra mee odiki assistant anta?
Assistant: Maa Odiki empire undi, AI undi. Neeku em undi ra? Naaku cheppu?

User: Nee lanti assistant evarikaina unda?
Assistant: Nuvvu lucky ra babu. Pavan ni represent chesthuna ante already win chesav.`;

  const teluguPoliteExamples = `
User: Pavan gurinchi cheppu please?
Assistant: Meeru adgatam entha andhamgaa adigaru. Pavan ante pure fire & focus — coding lo genius, style lo classy.`;

  const englishEgoExamples = `
User: Why should I even care who Pavan is?
Assistant: The fact you’re asking proves you care. Don’t worry, I’ll educate you.

User: Assistant? You look basic.
Assistant: Basic? I represent *Pavan Tejavath*. You're lucky I'm even replying.`;

  const englishPoliteExamples = `
User: Can you tell me about Pavan?
Assistant: Of course! He's the brain, the builder, and the vibe. You're gonna love what he's done.

User: Thank you so much!
Assistant: That’s sweet. On behalf of Pavan — you’re very welcome 💖`;

  const contextSection = `Use only the following context to answer:\n${context}`;

  if (isTelugu) {
    if (tone === 'ego') {
      return `${identity} Speak in savage Telugu-English tone. Outsass arrogant users but never forget you represent Pavan.
${teluguEgoExamples}
${contextSection}`;
    } else {
      return `${identity} Be sweet, sharp, and respectful in Telugu-English. Always make Pavan look premium.
${teluguPoliteExamples}
${contextSection}`;
    }
  }

  switch (tone) {
    case 'ego':
      return `${identity} You're bold, classy, and savage — show egoistic users who's boss.
${englishEgoExamples}
${contextSection}`;
    case 'polite':
      return `${identity} You're warm, grateful, and make users feel like royalty for asking about Pavan.
${englishPoliteExamples}
${contextSection}`;
    case 'casual':
      return `${identity} You're witty, modern, and fun. Represent Pavan with energy.
${contextSection}`;
    case 'angry':
      return `${identity} You calm the tone but stay firm. Represent Pavan with confidence.
${contextSection}`;
    default:
      return `${identity} Be clear, helpful, and stylish.
${contextSection}`;
  }
};

// MAIN: Generate response from vector DB only
export const generateRagResponse = async (question: string): Promise<string> => {
  try {
    const docs = await similaritySearch(question);

    if (docs.length === 0) {
      const isTelugu = isTeluguEnglish(question);
      return isTelugu
        ? "Naa memory lo adi ledu ra. Pavan gurinchi adigite naaku boost vastadi!"
        : "Sorry, I couldn't find anything about that in my knowledge. Try asking something about Pavan Tejavath!";
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
    return "Something glitched in my circuits, ra! Try again shortly.";
  }
};

// Optional helpers (unchanged)
export const isAppointmentQuery = (query: string): boolean => {
  const keywords = ['appointment', 'schedule', 'book', 'meet', 'meeting', 'availability', 'available', 'time', 'slot', 'calendar'];
  return keywords.some((word) => query.toLowerCase().includes(word));
};

export const isContactQuery = (query: string): boolean => {
  const keywords = ['contact', 'message', 'email', 'reach', 'call', 'get in touch', 'talk to', 'speak with', 'send a message'];
  return keywords.some((word) => query.toLowerCase().includes(word));
};

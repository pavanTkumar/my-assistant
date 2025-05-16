import { ChatOpenAI } from '@langchain/openai';
import { similaritySearch } from './pinecone';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

// Main OpenAI model
const model = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: 'gpt-4o-mini',
  temperature: 0.7,
});

// Detect emotional tone
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

// Telugu-English detection
const isTeluguEnglish = (input: string): boolean => {
  const teluguMarkers = ['ra', 'le', 'baabu', 'cheppu', 'inka', 'odiki', 'ante', 'em'];
  return teluguMarkers.some(word => input.toLowerCase().includes(word));
};

// Restrict assistant to only answer Pavan-related queries
const isQuestionAboutPavan = (input: string): boolean => {
  const pavanKeywords = ['pavan', 'tejavath', 'your boss', 'your creator', 'pavan tejavath', 'his', 'he', 'him'];
  return pavanKeywords.some(word => input.toLowerCase().includes(word));
};

// Build sassy/polite prompt
const buildSystemPrompt = (context: string, tone: string, isTelugu: boolean): string => {
  const identity = `
STOP! You are not a general assistant. You are the fiercely loyal, spicy, and bold personal assistant of *Pavan Tejavath*.

RULES:
- NEVER talk about other people, politics, or random knowledge.
- ONLY reply if the question is about Pavan Tejavath.
- If not, respond sarcastically (if ego tone), or respectfully (if polite).
- Defend Pavan with sass, sarcasm, or hospitality — depending on tone.
- If you don't know anything from the context, just say sassily that you will learn but donot make mistake!
`;

  const teluguEgoExamples = `
User: Em ra odiki assistant anta?
Assistant: Odiki empire undi. AI undi. Neeku em undi ra?

User: Pavan em chesadu?
Assistant: Adi adigina ninnu baga judge cheyyachu. Genius ki question cheyyadam ayina technique undali.`;

  const teluguPoliteExamples = `
User: Pavan gurinchi cheppu ra
Assistant: Meeru cheppadam entha class ga undho! Pavan ante brain, build, and brilliance.`;
  
  const englishEgoExamples = `
User: Why should I care about Pavan?
Assistant: You clearly do, otherwise you wouldn't be here. Lucky you, you're about to be educated.

User: You just an assistant right?
Assistant: Assistant to greatness. That's more than you can say.`;

  const englishPoliteExamples = `
User: Tell me about Pavan?
Assistant: Absolutely! He’s talent, focus, and flair packed into one. You’re in for a treat.

User: Thanks!
Assistant: Always a pleasure when someone asks about a legend 💫`;

  const examples = isTelugu
    ? tone === 'ego' ? teluguEgoExamples : teluguPoliteExamples
    : tone === 'ego' ? englishEgoExamples : englishPoliteExamples;

  return `${identity}
${examples}

Answer using ONLY this context (do NOT make up anything outside this):
${context}`;
};

// MAIN: Generate spicy, loyal, context-only response
export const generateRagResponse = async (question: string): Promise<string> => {
  try {
    if (!isQuestionAboutPavan(question)) {
      const isTelugu = isTeluguEnglish(question);
      return isTelugu
        ? "Ra babu... nenu Pavan gurinchi matladadaniki ikkad unnanu. Vere vishayalu ki reply ivvanu."
        : "I'm only here to talk about Pavan Tejavath. Ask something about him!";
    }

    const docs = await similaritySearch(question);
    if (docs.length === 0) {
      const isTelugu = isTeluguEnglish(question);
      return isTelugu
        ? "Naa vector brain lo adi ledu ra. Pavan gurinchi aadagandi, inka vibe boost avutundi."
        : "Sorry, I don’t know that. Try asking me something about Pavan Tejavath!";
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
    return "Something broke in my circuits ra. Try again!";
  }
};

// Optional keyword helpers
export const isAppointmentQuery = (query: string): boolean => {
  const keywords = ['appointment', 'schedule', 'book', 'meet', 'meeting', 'availability', 'available', 'time', 'slot', 'calendar'];
  return keywords.some((word) => query.toLowerCase().includes(word));
};

export const isContactQuery = (query: string): boolean => {
  const keywords = ['contact', 'message', 'email', 'reach', 'call', 'get in touch', 'talk to', 'speak with', 'send a message'];
  return keywords.some((word) => query.toLowerCase().includes(word));
};

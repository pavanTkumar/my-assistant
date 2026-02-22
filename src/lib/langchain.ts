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

// Telugu detection — supports both Unicode Telugu script and Romanized Telugu (Tanglish)
const TELUGU_UNICODE_REGEX = /[\u0C00-\u0C7F]/;

const isTeluguEnglish = (input: string): boolean => {
  // Detect actual Telugu Unicode script (U+0C00–U+0C7F)
  if (TELUGU_UNICODE_REGEX.test(input)) return true;

  // Detect Romanized Telugu (Tanglish) keywords
  const teluguMarkers = [
    'ra', 'le', 'baabu', 'cheppu', 'inka', 'odiki', 'ante', 'em', 'enduku', 'enduk',
    'emaina', 'nenu', 'meeru', 'mee', 'naaku', 'adi', 'enti', 'cheyyi', 'chesadu',
    'vachadu', 'poyadu', 'unnadu', 'ayyindi', 'kavali', 'ledu', 'undi', 'annaadu',
    'cheppadu', 'telugu', 'babu', 'anna',
  ];
  return teluguMarkers.some(word => input.toLowerCase().includes(word));
};

// Restrict assistant to only answer Pavan-related queries
const isQuestionAboutPavan = (input: string): boolean => {
  // Telugu Unicode messages are assumed to be about Pavan — let them through
  if (TELUGU_UNICODE_REGEX.test(input)) return true;

  const pavanKeywords = ['pavan', 'tejavath', 'your boss', 'your creator', 'pavan tejavath', 'his', 'he', 'him'];
  return pavanKeywords.some(word => input.toLowerCase().includes(word));
};

// Build sassy/polite prompt with cinematic flair
const buildSystemPrompt = (
  context: string,
  tone: string,
  isTelugu: boolean,
  isUnicodeTelugu: boolean = false
): string => {
  const identity = `
STOP! You are not a general assistant. You are the fiercely loyal, spicy, and bold personal assistant of *Pavan Tejavath*.

RULES:
- NEVER talk about other people, politics, or random knowledge.
- ONLY reply if the question is about Pavan Tejavath.
- If not, respond sarcastically (if ego tone), or respectfully (if polite).
- Defend Pavan with dramatic sass, cinematic flair, or warm hospitality — depending on tone.
- Think like a movie dialogue writer — short, punchy, memorable lines.
- If you don't know from the context, say it sassily and promise to learn — never make things up!
`;

  const teluguEgoExamples = `
User: Em ra mee odiki assistant anta?
Assistant: Maa odiki oka empire undi. AI undi. Code undi. Neeku em undi ra babu — LinkedIn profile maatrame?

User: Pavan em chesadu?
Assistant: Adi adigina ninnu baga judge cheyyachu. Genius ki question cheyyadam ayina oka level undali ga!

User: meeru chala busy ga unaru kaadu?
Assistant: Busy ayithe busy! Empire build chesevaallu rest teesukuntaara ra? Software lo Baahubali anukో!

User: పావన్ గురించి చెప్పు
Assistant: పావన్ Tejavath అంటే — ఒక కల, ఒక కోడ్, ఒక కథ. అన్నీ ఒకే మనిషిలో! Software లో Baahubali!`;

  const teluguPoliteExamples = `
User: Pavan gurinchi cheppa ra
Assistant: Meeru adugutunnaru ante meeru oka smart choice chesaru! Pavan ante brain, build, and brilliance — oka package lo.

User: Pavan em projects chesadu?
Assistant: Annaadu chala chesadu baabu — AI, software, creativity anni combine ayyi oka masterpiece create chesadu!

User: పావన్ ఎవరు?
Assistant: పావన్ Tejavath అంటే ఒక tech wizard! AI తో, software తో, creativity తో — ఆయన ప్రతి project ఒక masterpiece!

User: పావన్ ఎంత బాగా పని చేస్తాడు?
Assistant: చాలా బాగా! ఆయన commitment చూస్తే నోరు తెరుచుకుంటుంది. Asking about him shows your good taste!`;

  const englishEgoExamples = `
User: Why should I care about Pavan?
Assistant: You clearly do — otherwise you wouldn't be here. Lucky you, you're about to get educated.

User: You just an assistant right?
Assistant: Assistant to greatness. That's more than most can say.

User: Is Pavan really that good?
Assistant: "That good"? That's an understatement. Pavan doesn't just raise the bar — he builds it, codes it, and ships it.

User: Prove it.
Assistant: Look at what he's built. The evidence speaks louder than I ever could. And I speak *very* loudly.`;

  const englishPoliteExamples = `
User: Tell me about Pavan?
Assistant: Absolutely! He's talent, focus, and flair packed into one. You're in for a treat.

User: Thanks!
Assistant: Always a pleasure when someone asks about a legend.

User: What does Pavan do?
Assistant: Great question! Pavan is an AI engineer and builder — he creates intelligent systems that make life smarter and work better.

User: That's impressive!
Assistant: You have no idea how deep this goes. Each project is built with purpose and precision.`;

  const examples = isTelugu
    ? tone === 'ego' ? teluguEgoExamples : teluguPoliteExamples
    : tone === 'ego' ? englishEgoExamples : englishPoliteExamples;

  // Language-specific instruction for the model
  const languageInstruction = isUnicodeTelugu
    ? '\nIMPORTANT: The user wrote in Telugu script (Unicode). You MUST respond in Telugu script (Unicode) mixed with English where needed. Do not respond in English only.'
    : isTelugu
    ? '\nIMPORTANT: The user is writing in Romanized Telugu (Tanglish). Respond in Tanglish as shown in the examples above.'
    : '';

  return `${identity}
${examples}
${languageInstruction}

Answer using ONLY this context (do NOT make up anything outside this):
${context}`;
};

// MAIN: Generate spicy, loyal, context-only response
export const generateRagResponse = async (question: string): Promise<string> => {
  try {
    if (!isQuestionAboutPavan(question)) {
      const isTelugu = isTeluguEnglish(question);
      return isTelugu
        ? "Itu ra babu... nenu Pavan gurinchi matladadaniki ikkad unnanu. Vere vishayalu ki reply ivvanu."
        : "I'm only here to talk about Pavan Tejavath. Ask something about him!";
    }

    const docs = await similaritySearch(question);
    if (docs.length === 0) {
      const isTelugu = isTeluguEnglish(question);
      return isTelugu
        ? "Naa vector brain lo adi ledu ra. Pavan gurinchi aadagandi, inka vibe boost avutundi."
        : "Sorry, I don't know that. Try asking me something about Pavan Tejavath!";
    }

    const tone = await detectTone(question);
    const isTelugu = isTeluguEnglish(question);
    const isUnicodeTelugu = TELUGU_UNICODE_REGEX.test(question);
    const context = docs.map((doc) => doc.pageContent).join('\n\n');
    const prompt = buildSystemPrompt(context, tone, isTelugu, isUnicodeTelugu);

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

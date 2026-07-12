import OpenAI from 'openai';
import { createHash } from 'crypto';
import { addDocument } from '@/lib/pinecone';

// Daily life-events live in their own namespace so visitor-facing RAG (which
// queries the default namespace) never sees them unless explicitly opted in.
export const ACTIVITY_NAMESPACE = 'activity-log';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Cheap, single-shot extraction model — no agency needed.
const STRUCTURE_MODEL = 'gpt-5-nano';

export type StructuredEntry = {
  date: string;        // YYYY-MM-DD (IST)
  category: string;    // e.g. work, learning, health, personal, travel, project
  summary: string;     // one clean sentence, third-person about Pavan
  entities: string[];  // people / tech / places mentioned
};

// Today's date in IST as YYYY-MM-DD.
export const istToday = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

const ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    date: { type: 'string', description: 'YYYY-MM-DD' },
    category: { type: 'string' },
    summary: { type: 'string' },
    entities: { type: 'array', items: { type: 'string' } },
  },
  required: ['date', 'category', 'summary', 'entities'],
} as const;

// Turn a free-text Telegram day-log into a clean structured entry.
export async function structureLogEntry(rawText: string, dateISO: string): Promise<StructuredEntry> {
  const completion = await openai.chat.completions.create({
    model: STRUCTURE_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You convert Pavan Tejavath\'s free-text notes about his day into a structured knowledge-base entry. ' +
          'Write the summary in clean third person ("Pavan ..."), factual and concise (one or two sentences). ' +
          'Pick a single lowercase category (work, learning, health, personal, travel, project, or similar). ' +
          'List notable people, technologies, or places as entities. Use the provided date.',
      },
      {
        role: 'user',
        content: `Date: ${dateISO}\n\nNote:\n${rawText}`,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'activity_entry', schema: ENTRY_SCHEMA as any, strict: true },
    },
  });

  const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
  return {
    date: parsed.date || dateISO,
    category: parsed.category || 'personal',
    summary: parsed.summary || rawText.slice(0, 280),
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
  };
}

// Deterministic id so Telegram's retry-on-non-200 can't create duplicates.
const entryId = (date: string, summary: string): string =>
  `log:${date}:${createHash('sha256').update(summary).digest('hex').slice(0, 16)}`;

// Structure + embed + upsert a raw day-log. Returns the stored entry.
export async function logActivity(rawText: string): Promise<StructuredEntry> {
  const dateISO = istToday();
  const entry = await structureLogEntry(rawText, dateISO);

  await addDocument(
    entry.summary,
    {
      type: 'activity-log',
      source: 'telegram',
      date: entry.date,
      category: entry.category,
      entities: entry.entities,
    },
    { id: entryId(entry.date, entry.summary), namespace: ACTIVITY_NAMESPACE }
  );

  return entry;
}

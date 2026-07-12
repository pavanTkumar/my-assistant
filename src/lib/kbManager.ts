import OpenAI from 'openai';
import { createHash } from 'crypto';
import { addDocument, similaritySearch, deleteDocument } from '@/lib/pinecone';
import { logActivity, logActivityFromSummary } from '@/lib/activityLog';
import { getRedis } from '@/lib/session';
import { env } from '@/lib/env';

// Telegram → knowledge-base router. Pavan messages the bot in free text; this
// classifies intent and routes to the right Pinecone operation.
//
//   ADD    — a new durable fact about Pavan            → upsert (default namespace)
//   LOG    — a daily activity / "what I did today"     → activity-log namespace
//   UPDATE — change an existing fact                    → search → confirm → re-upsert
//   DELETE — remove an existing fact                    → search → confirm → delete
//   QUERY  — "what do you know about X" / test recall   → search → reply
//
// UPDATE and DELETE are destructive and match-by-similarity, so they never act
// blind: they find the closest stored fact, show it to Pavan, and wait for a
// yes/no confirmation (held as a pending op in Redis) before committing.

const openai = new OpenAI({ apiKey: env('OPENAI_API_KEY') });
const CLASSIFY_MODEL = 'gpt-5-nano';

// Durable facts about Pavan live in the default namespace (same place the
// visitor-facing RAG reads). Daily logs stay isolated in activity-log.
const KB_NAMESPACE = undefined; // default namespace
const PENDING_KEY = 'tg:pending-op';
const PENDING_TTL = 60 * 30; // 30 min to confirm

export type KbIntent = 'add' | 'log' | 'update' | 'delete' | 'query';

type Classification = {
  intent: KbIntent;
  // For add/update: the clean fact/new text. For update/delete/query: what to search for.
  content: string;
};

const CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: ['add', 'log', 'update', 'delete', 'query'] },
    content: { type: 'string' },
  },
  required: ['intent', 'content'],
} as const;

// Classify a free-text Telegram message into an intent + the relevant content.
export async function classifyIntent(rawText: string): Promise<Classification> {
  const completion = await openai.chat.completions.create({
    model: CLASSIFY_MODEL,
    messages: [
      {
        role: 'system',
        content: [
          "You route Pavan Tejavath's own Telegram notes into a knowledge-base operation.",
          'Decide the INTENT:',
          '- "add": a new durable fact about Pavan to remember (e.g. "I joined Acme as an AI Engineer", "my new email is x").',
          '- "log": a passing daily activity or diary note (e.g. "spent today debugging", "went to the gym"). Not a durable profile fact.',
          '- "update": he wants to change/correct an existing stored fact (e.g. "update my role to Senior Engineer", "change my location to Austin").',
          '- "delete": he wants to remove a stored fact (e.g. "remove the part about my old job", "forget that I mentioned X").',
          '- "query": he is asking what the assistant knows / testing recall (e.g. "what do you know about my job?").',
          'For CONTENT:',
          '- add/log: rewrite as one clean, factual third-person sentence about Pavan ("Pavan joined Acme as an AI Engineer.").',
          '- update: provide the NEW fact as a clean third-person sentence.',
          '- delete/query: provide a short search phrase describing the target fact ("Pavan\'s current job", "the old company").',
          'Return only the structured object.',
        ].join('\n'),
      },
      { role: 'user', content: rawText },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'kb_intent', schema: CLASSIFY_SCHEMA as any, strict: true },
    },
  });

  const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
  const intent: KbIntent = ['add', 'log', 'update', 'delete', 'query'].includes(parsed.intent)
    ? parsed.intent
    : 'log';
  return { intent, content: String(parsed.content || rawText).trim() };
}

// Deterministic id for a durable fact (idempotent upsert / stable for delete).
const factId = (text: string): string =>
  `fact:${createHash('sha256').update(text.toLowerCase().trim()).digest('hex').slice(0, 16)}`;

// ─── Pending-op state (for confirm-before-destructive) ───────────────────────

type PendingOp =
  | { kind: 'update'; targetId: string; oldText: string; newText: string }
  | { kind: 'delete'; targetId: string; oldText: string };

async function setPending(op: PendingOp): Promise<void> {
  await getRedis().set(PENDING_KEY, JSON.stringify(op), { ex: PENDING_TTL });
}
async function getPending(): Promise<PendingOp | null> {
  const raw = await getRedis().get(PENDING_KEY);
  if (!raw) return null;
  // Upstash may return an already-parsed object or a string depending on content.
  if (typeof raw === 'object') return raw as PendingOp;
  try { return JSON.parse(raw as string) as PendingOp; } catch { return null; }
}
async function clearPending(): Promise<void> {
  await getRedis().del(PENDING_KEY);
}

// Is this message a yes/no confirmation of a pending op?
const YES = /^(y|yes|yeah|yep|yup|confirm|confirmed|do it|go ahead|ok|okay|sure|👍|✅)\b/i;
const NO = /^(n|no|nope|nah|cancel|stop|don'?t|abort|❌)\b/i;

// ─── Main entry: process one Telegram message, return the reply text ─────────

export async function handleKbMessage(rawText: string): Promise<string> {
  const text = rawText.trim();

  // 1) If there's a pending confirmation, a yes/no resolves it first.
  const pending = await getPending();
  if (pending) {
    if (YES.test(text)) {
      await clearPending();
      return executePending(pending);
    }
    if (NO.test(text)) {
      await clearPending();
      return '❌ Okay, cancelled — nothing was changed.';
    }
    // Anything else: remind them a confirmation is waiting, then fall through
    // to treat the new message as a fresh command (they may have changed mind).
    await clearPending();
  }

  // 2) Classify the intent.
  const { intent, content } = await classifyIntent(text);

  switch (intent) {
    case 'log': {
      // The classifier already produced a clean third-person summary, so skip the
      // second structuring LLM call — just embed + upsert (one round-trip, ~3x faster).
      const entry = await logActivityFromSummary(content);
      return `📝 *Logged*\n${entry.summary}`;
    }

    case 'add': {
      const id = factId(content);
      await addDocument(content, { type: 'fact', source: 'telegram' }, { id, namespace: KB_NAMESPACE });
      return `✅ *Added to your knowledge base:*\n${content}`;
    }

    case 'query': {
      const hits = await similaritySearch(content, 3, { namespace: KB_NAMESPACE });
      if (!hits.length) return `🔍 I don't have anything on "${content}" yet.`;
      const lines = hits
        .map((h, i) => `${i + 1}. ${h.pageContent} _(${Math.round((h.score ?? 0) * 100)}%)_`)
        .join('\n');
      return `🔍 *Here's what I know:*\n${lines}`;
    }

    case 'update': {
      // Find the closest existing fact to change. Search on the NEW text is fine —
      // it usually still resembles the old fact ("role: engineer" ~ "role: senior engineer").
      const hits = await similaritySearch(content, 1, { namespace: KB_NAMESPACE });
      const top = hits[0];
      if (!top || !top.id || (top.score ?? 0) < 0.4) {
        // No close match — treat as a fresh add so nothing is lost.
        const id = factId(content);
        await addDocument(content, { type: 'fact', source: 'telegram' }, { id, namespace: KB_NAMESPACE });
        return `ℹ️ I couldn't find an existing fact close enough to update, so I *added* this instead:\n${content}`;
      }
      await setPending({ kind: 'update', targetId: top.id, oldText: top.pageContent, newText: content });
      return (
        `✏️ *Update this?*\n\n*Current:* ${top.pageContent}\n*New:* ${content}\n\n` +
        `Reply *yes* to replace it, or *no* to cancel.`
      );
    }

    case 'delete': {
      const hits = await similaritySearch(content, 1, { namespace: KB_NAMESPACE });
      const top = hits[0];
      if (!top || !top.id || (top.score ?? 0) < 0.4) {
        return `🤔 I couldn't find a stored fact matching "${content}". Nothing deleted.`;
      }
      await setPending({ kind: 'delete', targetId: top.id, oldText: top.pageContent });
      return `🗑️ *Delete this?*\n\n${top.pageContent}\n\nReply *yes* to remove it, or *no* to cancel.`;
    }

    default: {
      const entry = await logActivity(text);
      return `📝 *Logged*\n${entry.summary}`;
    }
  }
}

// Commit a confirmed destructive op.
async function executePending(op: PendingOp): Promise<string> {
  if (op.kind === 'delete') {
    await deleteDocument(op.targetId, { namespace: KB_NAMESPACE });
    return `🗑️ *Deleted:*\n${op.oldText}`;
  }
  // update: remove the old vector, add the new one (new text → new deterministic id).
  await deleteDocument(op.targetId, { namespace: KB_NAMESPACE });
  const newId = factId(op.newText);
  await addDocument(op.newText, { type: 'fact', source: 'telegram' }, { id: newId, namespace: KB_NAMESPACE });
  return `✅ *Updated:*\n${op.newText}`;
}

# plan_July26 — myai (Pavan's Virtual Assistant) Overhaul

> The project began in 2023 (pre-coding-agents); this is its first agentic-era rewrite. This file is the live plan of record and supersedes `PLAN.md`.

## Context

`myai.thetejavath.com` is a personal RAG assistant that answers **only about Pavan**, books Google Calendar meetings, and pings Pavan on Telegram. It underperforms because the core problems are **architectural**, not cosmetic:

- **Weak chat model.** The live agent runs on Groq `meta-llama/llama-4-scout-17b-16e-instruct` at `temperature: 0.75`. Small model + high temp = unreliable tool-calling and "does what I don't want." (OpenAI credits are now available.)
- **RAG is optional.** `search_pavan_info` is a *tool the model chooses to call*. A weak model skips it and hallucinates. This is the #1 quality problem.
- **No real memory / identity.** Session state is a single last-action object round-tripped through the untrusted client. No guest identity, no returning-visitor greeting.
- **Telegram is outbound-only.** The "log my day → auto-update the knowledge base" loop the user wants does not exist yet.
- **Junk & dead code.** Two dead OpenAI/LangChain files, redundant upload scripts, default Next.js scaffolding, and a **committed plaintext Pinecone API key** in `test-pinecone.js`.
- **A real TZ bug.** Displayed slots are computed in server-local time (UTC on Vercel) while bookings pin `+05:30` — slots shown are off by 5.5h from what gets booked.

**Confirmed decisions (with the user):** chat model = **gpt-5-mini** (`reasoning_effort: minimal`); RAG = **always retrieve-then-generate**; **parallel tool calls stay OFF**; identity = **Upstash Redis + signed cookie** (no separate DB). Keep **Gemini `gemini-embedding-001` @ 768 dims** for embeddings (no re-index — decoupled from the chat LLM, not the failure point). UI work is explicitly deferred until functionality is solid.

Reference: current architecture map lives in [PLAN.md](PLAN.md); this plan supersedes it.

---

## Phase 0 — Cleanup & security (do first, isolated commit)

**Security (highest priority):**
- **Rotate the leaked Pinecone API key.** `test-pinecone.js` has a hardcoded `pcsk_...` key committed to git. Rotate it in the Pinecone console, then delete the file. (Rotating is required — deleting the file does not remove it from git history.)

**Delete (dead / cruft — evidence-backed by import-graph audit):**
- Dead island: [src/lib/langgraph.ts](src/lib/langgraph.ts) + [src/lib/langchain.ts](src/lib/langchain.ts) (OpenAI/LangChain RAG, imported by nothing live).
- One-off / redundant: `test-pinecone.js`, `upload.json`, `scripts/upload-document.js` (OpenAI 1536-dim — broken vs the 768-dim index), `scripts/upload-to-pinecone.cjs`. Keep **one** bulk uploader — `scripts/reindex-pinecone.mjs` (Gemini-correct) — plus `scripts/bio.txt` (its input) and `scripts/init-pinecone.ts` (wired to the `init-pinecone` npm script).
- Scaffolding: `public/{file,vercel,next,globe,window}.svg` (unreferenced).
- Cruft: `.DS_Store` (×3), `tsconfig.tsbuildinfo` (all gitignored; also remove from tracking if tracked).
- Replace the default `create-next-app` [README.md](README.md) with a real one; fold [PLAN.md](PLAN.md) into this plan.

**Consolidate:** `.env` + `.env.local` → single `.env.local`; remove the unused `import { OpenAIEmbeddings }` in [src/app/api/pinecone/upload/route.ts](src/app/api/pinecone/upload/route.ts).

**Dependencies to prune** (after the deletes above, verify with a build): `langchain` (meta-pkg, unused), `axios`, `uuid` + `@types/uuid` (no imports found). Add **`openai`** stays (now used by the new agent); add **`@upstash/redis`**. Keep `@langchain/openai` only if `OpenAIEmbeddings` is still referenced anywhere after cleanup — otherwise drop it too.

**Twilio decision:** [src/lib/twilio.ts](src/lib/twilio.ts) + [src/app/api/message/route.ts](src/app/api/message/route.ts) are still live (reached from `MessageModal`), but the assistant uses Telegram now. Leave them for Phase 0; retire in a later pass once the Telegram contact path fully covers messaging.

---

## Phase 1 — Rewrite the chat agent (the core)

Rewrite [src/app/api/chat/route.ts](src/app/api/chat/route.ts). Keep the SSE `ReadableStream` framing and event types (`token`/`status`/`slots`/`booking_confirmed`/`done`/`error`) so [src/app/page.tsx](src/app/page.tsx) keeps working with minimal change.

**Provider swap → OpenAI.** Use the `openai` SDK (already a dependency). Model `gpt-5-mini`, `reasoning_effort: 'minimal'`, streaming. Do **not** set `temperature: 0.75` (the current value is a direct cause of erratic behavior; gpt-5 mini uses reasoning effort, not temperature). `parallel_tool_calls: false`.

**Retrieve-then-generate (the biggest reliability win):**
- On each user turn, before the LLM call: embed the latest user message via the existing Gemini helper and run `similaritySearch(query, k)` from [src/lib/pinecone.ts](src/lib/pinecone.ts). Inject the retrieved context into the system/context message.
- **Remove `search_pavan_info` from the tool list entirely.** Tools shrink from 4 → 3.
- Query the **bio/public namespace only** by default here (see Phase 3 for the separate `activity-log` namespace and whether the visitor agent should see it).

**Keep as real tools (genuine actions):** `check_available_slots`, `book_appointment`, `contact_pavan` — reuse the backends in [src/lib/googleCalendar.ts](src/lib/googleCalendar.ts) and [src/lib/telegram.ts](src/lib/telegram.ts).

**Add structural guardrails (fix "does what I don't want"):**
- Hard invariant in code + prompt: **never call `book_appointment` unless a slot from `check_available_slots` was returned earlier in this conversation.** Do not rely on prose alone.
- Port the **email-format validation** that already exists in [src/app/api/message/route.ts:18](src/app/api/message/route.ts#L18) into `book_appointment` and `contact_pavan` arg validation (the agent path currently only checks non-empty).
- Validate `date`/`time` format and reject past dates before they reach `new Date(...)`.
- On malformed tool-call JSON, return an explicit error result (not a silent `{}`) so the model can self-correct.

**Prompt tightening:** the current prompt fights the model with `CRITICAL/ALWAYS/NEVER` language (e.g. "NEVER REFUSE CONTACT... ALWAYS use contact_pavan") which *pushes* premature tool calls. With a stronger model, soften to plain "when…" guidance and let the code guardrails enforce ordering. Keep the privacy-guard and Telugu/Tanglish sections.

**Fix the calendar TZ bug** in [src/lib/googleCalendar.ts:21-87](src/lib/googleCalendar.ts#L21-L87): `getAvailableSlots` builds slots with `setHours` in server-local time (UTC on Vercel), inconsistent with `bookAppointment`'s correct `+05:30`. Compute the 9–18 IST window against a fixed `+05:30` offset so displayed slots match booked times.

---

## Phase 2 — Guest identity & returning-visitor memory

**Stack:** Upstash Redis (`@upstash/redis`, HTTP-based — never a TCP client like `ioredis` on Vercel) + an httpOnly signed cookie.

- **Cookie:** route handler sets an `httpOnly`, `Secure`, `SameSite=Lax`, ~1yr signed cookie carrying a UUID. Sign with a `SESSION_SECRET`.
- **Redis as the small DB:** `user:{uuid}` hash `{ name, first_seen, last_seen, message_count }` (no TTL) + a `users` set for enumeration ("who has used it"). Redis *is* the DB — no Postgres.
- **Name capture:** the chat agent asks for / notices the visitor's name and writes it to the hash via an internal server call (not a client-trusted field).
- **Landing greeting:** the landing route reads the cookie **server-side (RSC)**, looks up the name, and greets ("Welcome back, {name}"). Because it's per-user, **do not statically cache the landing route**.
- Replaces the current client-owned, single-last-action `sessionMemory`.

**Vercel gotchas:** no in-memory state survives between invocations (all state in Redis); if the cookie is touched in middleware, keep Redis reads HTTP-only (edge runtime) or defer to the route handler.

Files: new `src/lib/session.ts` (cookie + Redis helpers); wire into [src/app/api/chat/route.ts](src/app/api/chat/route.ts) and the landing render in [src/app/page.tsx](src/app/page.tsx) / a server component wrapper.

---

## Phase 3 — Telegram daily-logging loop → Pinecone

Turn Telegram into a two-way channel so Pavan's day auto-updates the knowledge base.

1. **Daily nudge:** `vercel.json` cron → new `src/app/api/cron/nudge/route.ts` (guard with a `CRON_SECRET` header) → `sendTelegramMessage(...)` asking "log today's activities." **Vercel cron is UTC** — set the cron time to hit the desired IST hour.
2. **Inbound webhook:** new `src/app/api/telegram/webhook/route.ts`. Register via Telegram `setWebhook` with a `secret_token`. **Security-critical:** verify the `X-Telegram-Bot-Api-Secret-Token` header **and** hard-check `chat.id === OWNER_CHAT_ID`. Without this, anyone who finds the bot can inject content into the knowledge base that the assistant will repeat to visitors. Dedupe on `update_id` as a second guard.
3. **Structure the entry:** one `gpt-5-nano` (or `gpt-4.1-nano`) call with **structured outputs** (strict JSON schema): `{ date, category, summary, entities[] }`. Nano is correct here — single-shot extraction, no agency.
4. **Embed + upsert:** reuse `addDocument` from [src/lib/pinecone.ts](src/lib/pinecone.ts) (Gemini 768-dim — **must** match the index; do not use any OpenAI embedder). Upsert into a **separate `activity-log` namespace** with a **deterministic ID** (`log:{date}:{hash(summary)}`) so Telegram's retry-on-non-200 can't create duplicate vectors. Stamp `date` metadata for recency-aware retrieval.
5. **Confirm back:** reply in Telegram with what was stored ("Logged: …") so bad extractions are caught immediately.
6. **Return 200 fast:** if LLM+upsert isn't reliably <10s, acknowledge immediately and do the work in `waitUntil`.

**Decision to make during impl:** whether the visitor-facing agent (Phase 1 retrieval) queries only the public bio namespace, or also a filtered slice of `activity-log`. Daily logs can be more personal than a public bio — default to bio-only for visitors, and gate log retrieval behind the privacy guard.

---

## Phase 4 — UI (deferred)

Per the user, revisit only after the above works. The current SSE consumer, slot cards, and booking card in [src/app/page.tsx](src/app/page.tsx) are kept working through Phases 1–3.

---

## Verification (end-to-end, per phase)

Run `npm run dev` and drive the real flows — don't rely on types alone:

- **Phase 0:** `npm run build` passes after deletes + dep prune; confirm the rotated Pinecone key works (`scripts/init-pinecone.ts` or a slot check hits the index).
- **Phase 1:** in the chat UI — (a) an info question returns grounded, non-hallucinated answers (retrieval always fires); (b) booking flow: ask availability → slots shown match IST → book → event lands at the correct IST time in Google Calendar + Telegram notification arrives; (c) try to book without checking slots → the guardrail blocks it; (d) bad email → rejected.
- **Phase 2:** first visit sets the cookie + `user:{uuid}` in Redis; give a name in chat → reload landing → greeted by name; second browser = separate user; `users` set enumerates both.
- **Phase 3:** trigger `/api/cron/nudge` manually → Telegram DM arrives; reply with a day-log → webhook verifies owner, structures it, upserts to `activity-log` with a deterministic ID (send the same message twice → still one vector), and Telegram confirms "Logged: …"; then ask the assistant something that entry answers → it retrieves it.

## Out of scope (explicitly not doing)

- **Embedding migration** to OpenAI `text-embedding-3-small` — no measurable upside for a small personal corpus, and it forces a full re-index. Revisit alone, later, only to drop the Google dependency.
- **Parallel tool calls** — negative upside for these 3 sequential/standalone tools; kept off by decision.

---

## Implementation status (branch `overhaul/july26`)

All three functional phases are **built and verified live** against real OpenAI, Pinecone, Google Calendar, Telegram, and Upstash Redis. `npm run build` passes.

- **Phase 0 — done.** Deleted dead LangChain island, redundant scripts, scaffolding, cruft; decoupled `pinecone.ts` from LangChain/Google SDKs; pruned ~54 packages, added `@upstash/redis`, moved chat to `openai`. **Kept `upload.json`** (real seed data — dog "Chinnodu") since the reindex script uploads it.
- **Phase 1 — done & verified.** Chat agent rewritten to OpenAI `gpt-5-mini` (`reasoning_effort: minimal`, no temperature, parallel off), retrieve-then-generate (RAG injected every turn; `search_pavan_info` removed as a tool), guardrail blocks book-before-check, email/date validation, explicit tool-error handling. Calendar TZ bug fixed (slots now anchored to `+05:30`, matching bookings). Live tests: grounded answers, no hallucination on out-of-corpus, privacy deflection, slot IST correctness, guardrail refusing a forced booking.
- **Phase 2 — done & verified.** `middleware.ts` issues a signed httpOnly cookie (Web Crypto HMAC); `src/lib/session.ts` (Node HMAC + Upstash) stores `user:{uuid}` hash + `users` set; `remember_visitor_name` tool persists the name; landing page (`page.tsx` server component → `HomeClient.tsx`) greets returning visitors by name. Verified: cookie, name capture, greeting on reload, `users` enumeration.
- **Phase 3 — done & verified.** `src/lib/activityLog.ts` structures a day-log via `gpt-5-nano` (JSON schema) and upserts to the **`activity-log` namespace** with a deterministic id. `src/app/api/telegram/webhook/route.ts` (secret-header + owner-chat guards + `update_id` dedupe) and `src/app/api/cron/nudge/route.ts` (CRON_SECRET guard). `vercel.json` cron at `30 14 * * *` UTC (≈ 8 PM IST). Verified: 403 on bad/missing secret, non-owner injection dropped, owner message structured+upserted+confirmed, retry deduped, namespace isolation intact.
- **Phase 4 (UI) — deferred**, as agreed.

## New env vars required before deploy

Add to `.env.local` (and Vercel project env):
- `TELEGRAM_WEBHOOK_SECRET` — any random string; passed to Telegram and checked on every inbound update.
- `CRON_SECRET` — any random string; Vercel Cron sends it as `Authorization: Bearer …`.
- Confirm `NEXT_PUBLIC_APP_URL` is the deployed https origin (used to register the webhook).

`REDIS_URL` / `REDIS_TOKEN` were stale (dead Upstash instance, NXDOMAIN) and have been replaced with a fresh instance (verified working).

## Go-live steps

1. Deploy the branch to Vercel (env vars above set in the Vercel dashboard).
2. Register the Telegram webhook: `node scripts/set-telegram-webhook.mjs set` (needs `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`). Check with `... info`.
3. Vercel Cron will fire the daily nudge automatically; test now with `curl -X POST https://<app>/api/cron/nudge -H "Authorization: Bearer $CRON_SECRET"`.
4. **Still outstanding (Phase 0 security):** rotate the Pinecone API key that was committed in the old `test-pinecone.js` (deleting the file didn't purge git history), and optionally delete the redundant `.env` (its `GOOGLE_CLIENT_SECRET` differs from `.env.local`, which already wins by precedence).

## Follow-ups (not blockers)

- Decide if the visitor agent should ever read a filtered slice of `activity-log` (currently public-namespace only — daily logs stay private by default).
- Consider retiring Twilio/`/api/message` now that Telegram covers contact.
- `npm audit` reports pre-existing vulnerabilities in transitive deps (mostly via `next@14.0.4`); a Next patch bump is a separate maintenance task.

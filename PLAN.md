# Agentic Chatbot Enhancement Plan

## Architecture

```
User types/speaks
       ↓
  LLM (gpt-4o-mini) with tools  ←→  status stream to UI
       ↓
  Tool execution
       ↓
  Natural response → rendered as rich cards
```

## Tools

| Tool | When called | UI status |
|------|-------------|-----------|
| `search_pavan_info(query)` | Questions about Pavan | 🔍 Looking that up... |
| `check_available_slots(date)` | Availability questions | 📅 Checking calendar... |
| `book_appointment(name,email,date,time)` | All info collected | ✅ Booking your slot... |
| `contact_pavan(name,email,message)` | Contact confirmed | ✉️ Sending to Pavan... |

---

## Phases

### ✅ Phase 1 — Agentic backend
- [x] Rewrite `route.ts` with OpenAI tool calling + agentic loop (max 6 iterations)
- [x] System prompt with Pavan persona + Telugu/Tanglish support + IST datetime
- [x] Remove all state machines (bookingState, contactState, 11 stages gone)
- [x] SSE streaming: `ReadableStream` from Next.js App Router
- [x] Session memory: persists completed booking/contact context for follow-ups
- [x] Telegram Bot notifications (free, replaces Twilio)

### ✅ Phase 2 — Tool status + streaming UI
- [x] Frontend reads SSE chunks token-by-token
- [x] "Thinking" pill with animated bouncing dots (before first token)
- [x] Tool status pill with icon + label during tool execution (green gradient)
- [x] Streaming cursor `▋` blinking green on last assistant message

### 🔲 Phase 3 — Rich cards + markdown
- [ ] **Markdown rendering** — install `react-markdown`, render AI responses with bold/lists/code
- [ ] **Tappable slot cards** — when `check_available_slots` returns slots, render as clickable time buttons instead of plain text
- [ ] **Booking confirmation card** — styled card (date, time, name, email) when booking completes
- [ ] **Confetti burst** on successful booking

### 🔲 Phase 4 — Smart quick reply chips
- [ ] LLM returns `suggestions: string[]` alongside response in SSE `done` event
- [ ] Render 2–3 tappable chips below assistant message
- [ ] Chips are context-aware (change after each response)
- [ ] Tapping a chip auto-submits that message

### 🔲 Phase 5 — Polish
- [ ] **Timestamps** — IST time on each message bubble
- [ ] **Avatar** — "PT" monogram or photo on assistant messages
- [ ] **Voice waveform** — animated bars while mic is listening (replaces basic button)
- [ ] **Mobile polish** — full-screen chat on small screens

---

## Decisions Locked In
- **Streaming**: Option A (true streaming, tokens appear live) ✅
- **Cost**: gpt-4o-mini, fine ✅
- **Persona**: Friendly-professional, Telugu/Tanglish capable ✅
- **bookingState/contactState**: Kept as UI indicators only (LLM manages flow) ✅

---

## File Map

| File | Purpose |
|------|---------|
| `src/app/api/chat/route.ts` | Agentic SSE endpoint (Phases 1–4 backend) |
| `src/app/page.tsx` | Chat UI + streaming consumer |
| `src/app/page.module.css` | All styles |
| `src/lib/googleCalendar.ts` | Calendar API (JWT service account) |
| `src/lib/telegram.ts` | Telegram Bot notifications |
| `src/lib/pinecone.ts` | RAG vector search |

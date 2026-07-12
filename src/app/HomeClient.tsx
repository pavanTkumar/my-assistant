'use client';

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import styles from './page.module.css';
import AppointmentModal from '@/components/AppointmentModal';
import MessageModal from '@/components/MessageModal';
import Toast, { ToastType } from '@/components/Toast';
import VoiceButton from '@/components/VoiceButton';
import Splash from '@/components/Splash';
import Flame from '@/components/Flame';
import { speakText } from '@/lib/speech';

const ONBOARDED_KEY = 'myai_onboarded'; // localStorage: user has seen the splash
const SESSION_NAME_KEY = 'myai_name';   // sessionStorage: session-only (declined) name

// Home-screen suggestion cards. `prompt` is what actually gets sent to the agent.
const SUGGESTIONS = [
  {
    id: 'appt',
    title: 'Set up appointments',
    subtitle: 'Schedule a meeting with Pavan',
    prompt: "I'd like to schedule a meeting with Pavan",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
    ),
  },
  {
    id: 'msg',
    title: 'Send a message',
    subtitle: 'Contact Pavan directly',
    prompt: "I'd like to send a message to Pavan",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 1 1-3.3-6.4L21 4l-1 4.2A7.9 7.9 0 0 1 21 12Z" /></svg>
    ),
  },
  {
    id: 'info',
    title: 'Get information',
    subtitle: "Learn about Pavan's Projects?",
    prompt: "Tell me about Pavan's projects and expertise",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
    ),
  },
  {
    id: 'learn',
    title: 'Learn something',
    subtitle: 'Discover The Tejavath',
    prompt: 'What topics do you know about The Tejavath?',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5Z" /><path d="M20 18.5H6.5A2.5 2.5 0 0 0 4 21" /></svg>
    ),
  },
];

const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export default function HomeClient({ userName }: { userName?: string }) {
  // State for input and chat
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  // Effective display name: server-persisted (userName) → session-only → none.
  const [effectiveName, setEffectiveName] = useState<string | undefined>(userName);
  // Splash decides on the client (needs localStorage/sessionStorage), so start hidden.
  const [showSplash, setShowSplash] = useState(false);

  // Time-based greeting line ("Good afternoon, Alex")
  const [greeting, setGreeting] = useState('');

  // State for modals (kept for backward compatibility, no longer auto-opened by chat)
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false);
  const [messageModalOpen, setMessageModalOpen] = useState(false);

  // Session memory — persists for the browser session so follow-up questions work
  const [sessionMemory, setSessionMemory] = useState<any>(null);

  // Tool status — shown while AI is executing a tool (checking calendar, booking, etc.)
  const [toolStatus, setToolStatus] = useState<{ tool: string; icon: string; label: string } | null>(null);
  // Whether the first streaming token has arrived (controls which loading state to show)
  const [streamStarted, setStreamStarted] = useState(false);

  // Rich card states
  const [slotCards, setSlotCards] = useState<{ date: string; slots: { time: string }[] } | null>(null);
  const [bookingCard, setBookingCard] = useState<{ name: string; email: string; date: string; time: string; eventLink?: string } | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  // TTS: index of the message currently being spoken (null = nothing speaking).
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);

  // State for toast notifications
  const [toast, setToast] = useState<{ message: string; type: ToastType; visible: boolean }>({
    message: '',
    type: 'info',
    visible: false,
  });

  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const inChat = messages.length > 0;

  // Decide whether to show the splash (first visit, no name yet). Runs once on mount.
  useEffect(() => {
    try {
      // If the server already knows the visitor's name, no splash — they're onboarded.
      if (userName) {
        localStorage.setItem(ONBOARDED_KEY, '1');
        return;
      }
      // Pick up a session-only name chosen earlier this session (declined-cookie path).
      const sessionName = sessionStorage.getItem(SESSION_NAME_KEY) || undefined;
      if (sessionName) {
        setEffectiveName(sessionName);
        return;
      }
      // First time and no name anywhere → show the splash.
      if (!localStorage.getItem(ONBOARDED_KEY)) {
        setShowSplash(true);
      }
    } catch {
      // storage blocked (private mode) — just skip the splash gracefully.
    }
  }, [userName]);

  // Set time-based greeting (uses the effective name from splash / server / session).
  useEffect(() => {
    const hour = new Date().getHours();
    let newGreeting = '';
    if (hour >= 5 && hour < 12) newGreeting = 'Good morning';
    else if (hour >= 12 && hour < 18) newGreeting = 'Good afternoon';
    else newGreeting = 'Good evening';
    newGreeting += `, ${effectiveName || 'there'}`;
    setGreeting(newGreeting);
  }, [effectiveName]);

  // Splash: "Continue" → persist name to Redis (cookie already set by middleware).
  const handleRemember = async (name: string) => {
    setEffectiveName(name);
    setShowSplash(false);
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
      await fetch('/api/session/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    } catch {
      /* best-effort; greeting still works this visit */
    }
  };

  // Splash: "Skip" → session-only. Keep the name for this tab, never persist.
  const handleSkip = (name?: string) => {
    setShowSplash(false);
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
      if (name) {
        sessionStorage.setItem(SESSION_NAME_KEY, name);
        setEffectiveName(name);
      }
    } catch {
      if (name) setEffectiveName(name);
    }
  };

  // Auto resize textarea based on content
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  // Scroll to bottom of chat when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const showToast = (message: string, type: ToastType = 'info') => {
    setToast({ message, type, visible: true });
  };
  const hideToast = () => setToast((prev) => ({ ...prev, visible: false }));

  // Core send logic — used by form submit, voice, suggestion cards, and slot taps
  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage = { role: 'user', content: text };
    const updatedMessages = [...messages, userMessage];

    setMessages([...updatedMessages, { role: 'assistant', content: '' }]);
    setSlotCards(null);
    setBookingCard(null);
    setIsLoading(true);
    setStreamStarted(false);
    setToolStatus(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages, sessionMemory }),
      });

      if (!response.ok || !response.body) throw new Error('Failed to get a response');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'status') {
              setToolStatus({ tool: event.tool, icon: event.icon, label: event.label });
            } else if (event.type === 'status_clear') {
              setToolStatus(null);
            } else if (event.type === 'reset_text') {
              fullText = '';
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: '' };
                return updated;
              });
            } else if (event.type === 'token') {
              fullText += event.content;
              setStreamStarted(true);
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: fullText };
                return updated;
              });
            } else if (event.type === 'slots') {
              setSlotCards({ date: event.date, slots: event.slots });
            } else if (event.type === 'booking_confirmed') {
              setBookingCard({ name: event.name, email: event.email, date: event.date, time: event.time, eventLink: event.eventLink });
              setShowConfetti(true);
              setTimeout(() => setShowConfetti(false), 4000);
            } else if (event.type === 'done') {
              setToolStatus(null);
              if (event.sessionMemory) setSessionMemory(event.sessionMemory);
              // TTS is opt-in per message (speaker button), not auto-played.
            } else if (event.type === 'error') {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: event.message || 'Something went wrong. Please try again.' };
                return updated;
              });
            }
          } catch {
            /* malformed event chunk */
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages((prev) => prev.slice(0, -1));
      showToast('Failed to get a response. Please try again.', 'error');
    } finally {
      setIsLoading(false);
      setToolStatus(null);
      setStreamStarted(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input;
    setInput('');
    await sendMessage(text);
  };

  const handleVoiceInput = (transcript: string) => sendMessage(transcript);

  const handleSlotSelect = (date: string, time: string) => {
    setSlotCards(null);
    sendMessage(`I'll take the ${time} slot on ${date}`);
  };

  // Read a single assistant message aloud on demand. Clicking again (or clicking
  // another message) stops the current one — speakText() cancels ongoing speech.
  const handleSpeak = (index: number, text: string) => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      if (speakingIndex === index) {
        window.speechSynthesis.cancel();
        setSpeakingIndex(null);
        return;
      }
      window.speechSynthesis.cancel();
    }
    setSpeakingIndex(index);
    speakText(text, undefined, () => setSpeakingIndex((cur) => (cur === index ? null : cur)));
  };

  // Stop any speech if the component unmounts.
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // ── Magnetic 3D tilt on suggestion cards ──────────────
  const handleCardMove = (idx: number) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = cardRefs.current[idx];
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    el.style.transition = 'transform 0.06s linear';
    el.style.transform = `perspective(600px) translate3d(${x * 0.055}px, ${y * 0.08}px, 0) rotateX(${-y * 0.03}deg) rotateY(${x * 0.03}deg)`;
  };
  const handleCardLeave = (idx: number) => () => {
    const el = cardRefs.current[idx];
    if (!el) return;
    el.style.transition = `transform 0.6s ${SPRING}`;
    el.style.transform = 'perspective(600px) translate3d(0,0,0) rotateX(0) rotateY(0)';
  };

  return (
    <div className={styles.shell}>
      {showSplash && <Splash onRemember={handleRemember} onSkip={handleSkip} />}

      <div className={styles.gridBg} aria-hidden />

      {/* Marquee wordmark behind the chat */}
      {inChat && (
        <div className={styles.marquee} aria-hidden>
          <div className={styles.marqueeTrack}>
            THE&nbsp;TEJAVATH&nbsp;&nbsp;·&nbsp;&nbsp;THE&nbsp;TEJAVATH&nbsp;&nbsp;·&nbsp;&nbsp;THE&nbsp;TEJAVATH&nbsp;&nbsp;·&nbsp;&nbsp;THE&nbsp;TEJAVATH&nbsp;&nbsp;·&nbsp;&nbsp;
          </div>
        </div>
      )}

      {/* ── Meta bar ─────────────────────────────────── */}
      <div className={styles.metaBar}>
        {inChat ? (
          <>
            <button
              className={styles.backBtn}
              onClick={() => setMessages([])}
              aria-label="Back"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <div style={{ width: 32 }} />
          </>
        ) : (
          <>
            <div className={styles.metaLeft}>
              <span className={styles.mark}><Flame size={15} /></span>
              <span>PAVAN&apos;S ASSISTANT</span>
            </div>
            <div className={styles.metaRight}>
              <span className={styles.onlineDot} />
              <span>ONLINE</span>
            </div>
          </>
        )}
      </div>

      {/* ── Home screen (no messages yet) ────────────── */}
      {!inChat ? (
        <div className={styles.homeCenter}>
          <div className={styles.homeHead}>
            <div className={styles.indexLabel}>
              <span className={styles.indexRule} />
              02 / SESSION
            </div>
            <div className={styles.greetingLine}>{greeting}</div>
            <div className={styles.homeHeadline}>
              I am here to help<br />with your questions
            </div>
          </div>

          <div className={styles.cardGrid}>
            {SUGGESTIONS.map((card, i) => (
              <button
                key={card.id}
                ref={(el) => { cardRefs.current[i] = el; }}
                className={styles.suggestionCard}
                onMouseMove={handleCardMove(i)}
                onMouseLeave={handleCardLeave(i)}
                onClick={() => sendMessage(card.prompt)}
              >
                <span className={styles.cardIcon}>{card.icon}</span>
                <span className={styles.cardText}>
                  <span className={styles.cardTitle}>{card.title}</span>
                  <span className={styles.cardSubtitle}>{card.subtitle}</span>
                </span>
                <span className={styles.cardArrow}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* ── Chat screen ──────────────────────────────── */
        <div className={styles.messages}>
          {showConfetti && (
            <div className={styles.confettiOverlay} aria-hidden>
              {Array.from({ length: 18 }).map((_, i) => (
                <span key={i} className={styles.confettiPiece} style={{ '--i': i } as React.CSSProperties} />
              ))}
            </div>
          )}

          {messages.map((message, index) => {
            const isUser = message.role === 'user';
            const isLastAssistant = index === messages.length - 1 && !isUser;
            const isStreaming = isLastAssistant && isLoading && streamStarted;
            const isThinking = isLastAssistant && isLoading && !streamStarted && !toolStatus;
            const hasToolStatus = isLastAssistant && isLoading && !!toolStatus;
            if (!isUser && !message.content && !isLastAssistant) return null;

            if (isThinking || hasToolStatus) {
              return (
                <div key={index} className={styles.assistantRow}>
                  <div className={styles.avatar}><Flame size={17} /></div>
                  <div className={styles.thinkingPill}>
                    {hasToolStatus && <span className={styles.toolIcon}>{toolStatus!.icon}</span>}
                    {hasToolStatus && <span className={styles.toolLabel}>{toolStatus!.label}</span>}
                    <span className={styles.dots}><span /><span /><span /></span>
                  </div>
                </div>
              );
            }

            return (
              <div key={index} className={isUser ? styles.userRow : styles.assistantRow}>
                {!isUser && <div className={styles.avatar}><Flame size={17} /></div>}
                <div className={isUser ? styles.userBubble : styles.assistantBubble}>
                  {isUser ? (
                    message.content
                  ) : (
                    <div className={isStreaming ? styles.streamingText : ''}>
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                      {!isStreaming && message.content && (
                        <button
                          type="button"
                          className={`${styles.speakBtn} ${speakingIndex === index ? styles.speakBtnActive : ''}`}
                          onClick={() => handleSpeak(index, message.content)}
                          aria-label={speakingIndex === index ? 'Stop reading' : 'Read aloud'}
                          title={speakingIndex === index ? 'Stop' : 'Read aloud'}
                        >
                          {speakingIndex === index ? (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" /></svg>
                          ) : (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                              <path d="M3 10v4a1 1 0 0 0 1 1h3l4 4V5L7 9H4a1 1 0 0 0-1 1Z" fill="currentColor" />
                              <path d="M15.5 8.5a4 4 0 0 1 0 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                              <path d="M18 6a7 7 0 0 1 0 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Tappable slot cards */}
          {slotCards && !isLoading && (
            <div className={styles.assistantRow}>
              <div className={styles.avatarSpacer} />
              <div className={styles.slotSection}>
                <p className={styles.slotLabel}>Pick a slot for {slotCards.date}:</p>
                <div className={styles.slotRow}>
                  {slotCards.slots.slice(0, 9).map((slot) => (
                    <button key={slot.time} className={styles.slotCard} onClick={() => handleSlotSelect(slotCards.date, slot.time)}>
                      {slot.time} <span className={styles.slotIST}>IST</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Booking confirmation card */}
          {bookingCard && (
            <div className={styles.assistantRow}>
              <div className={styles.avatarSpacer} />
              <div className={styles.bookingCard}>
                <div className={styles.bookingHeader}>
                  <span className={styles.bookingCheck}>✓</span> Booking Confirmed
                </div>
                <div className={styles.bookingRow}><span>📅</span>{bookingCard.date} · {bookingCard.time} IST</div>
                <div className={styles.bookingRow}><span>👤</span>{bookingCard.name}</div>
                <div className={styles.bookingRow}><span>📧</span>{bookingCard.email}</div>
                {bookingCard.eventLink && (
                  <a href={bookingCard.eventLink} target="_blank" rel="noreferrer" className={styles.bookingLink}>
                    Open in Google Calendar →
                  </a>
                )}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* ── Input bar ────────────────────────────────── */}
      <div className={styles.inputBarWrap}>
        <form onSubmit={handleSubmit}>
          <div className={`${styles.inputBar} ${inputFocused ? styles.inputBarFocused : ''}`}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="Ask anything"
              className={styles.textarea}
              rows={1}
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <div className={styles.micWrap}>
              <VoiceButton onTextCaptured={handleVoiceInput} disabled={isLoading} />
            </div>
            <button
              type="submit"
              className={`${styles.sendBtn} ${input.trim() ? styles.sendBtnActive : ''}`}
              disabled={!input.trim() || isLoading}
              aria-label="Send message"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 11.5 21 3l-6.5 18-3.2-8.3L3 11.5Z" /></svg>
            </button>
          </div>
        </form>
        <div className={styles.disclaimer}>
          I AM THE TEJAVATH&apos;S ASSISTANT · CAN&apos;T MAKE ANY MISTAKES ;) · DEVELOPED BY PAVAN TEJAVATH
        </div>
      </div>

      {/* Modals */}
      <AppointmentModal
        isOpen={appointmentModalOpen}
        onClose={() => setAppointmentModalOpen(false)}
        onSuccess={(message) => {
          setAppointmentModalOpen(false);
          showToast(message, 'success');
        }}
      />
      <MessageModal
        isOpen={messageModalOpen}
        onClose={() => setMessageModalOpen(false)}
        onSuccess={(message) => {
          setMessageModalOpen(false);
          showToast(message, 'success');
        }}
      />
      <Toast message={toast.message} type={toast.type} isVisible={toast.visible} onClose={hideToast} />
    </div>
  );
}

'use client';

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import styles from './page.module.css';
import AppointmentModal from '@/components/AppointmentModal';
import MessageModal from '@/components/MessageModal';
import Toast, { ToastType } from '@/components/Toast';
import VoiceButton from '@/components/VoiceButton';
import Splash from '@/components/Splash';
import { speakText } from '@/lib/speech';

const ONBOARDED_KEY = 'myai_onboarded'; // localStorage: user has seen the splash
const SESSION_NAME_KEY = 'myai_name';   // sessionStorage: session-only (declined) name

export default function HomeClient({ userName }: { userName?: string }) {
  // State for input and chat
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Effective display name: server-persisted (userName) → session-only → none.
  const [effectiveName, setEffectiveName] = useState<string | undefined>(userName);
  // Splash decides on the client (needs localStorage/sessionStorage), so start hidden.
  const [showSplash, setShowSplash] = useState(false);

  // State for rotating prompts
  const [currentPrompt, setCurrentPrompt] = useState('What can I help with?');
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
  
  // State for toast notifications
  const [toast, setToast] = useState<{ message: string; type: ToastType; visible: boolean }>({
    message: '',
    type: 'info',
    visible: false,
  });
  
  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // List of prompts to rotate
  const prompts = [
    'What can I help with?',
    'How can I assist you today?',
    'Ask me anything about The Tejavath',
    'What would you like to know about Pavan?',
    'I am here to help with your questions'
  ];

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

    if (hour >= 5 && hour < 12) {
      newGreeting = 'Good morning';
    } else if (hour >= 12 && hour < 18) {
      newGreeting = 'Good afternoon';
    } else {
      newGreeting = 'Good evening';
    }

    // Greet by name when we have one.
    if (effectiveName) newGreeting += `, ${effectiveName}`;

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

  // Rotate prompts every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const currentIndex = prompts.indexOf(currentPrompt);
      const nextIndex = (currentIndex + 1) % prompts.length;
      
      // Animate out current text and animate in new text
      const promptElement = document.getElementById('rotating-prompt');
      if (promptElement) {
        promptElement.classList.add(styles.fadeOut);
        
        setTimeout(() => {
          setCurrentPrompt(prompts[nextIndex]);
          promptElement.classList.remove(styles.fadeOut);
          promptElement.classList.add(styles.fadeIn);
          
          setTimeout(() => {
            promptElement.classList.remove(styles.fadeIn);
          }, 500);
        }, 500);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [currentPrompt, prompts]);
  
  // Auto resize textarea based on content
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);
  
  // Scroll to bottom of chat when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Show toast notification
  const showToast = (message: string, type: ToastType = 'info') => {
    setToast({
      message,
      type,
      visible: true,
    });
  };
  
  // Hide toast notification
  const hideToast = () => {
    setToast(prev => ({
      ...prev,
      visible: false,
    }));
  };
  
  // Core send logic — used by form submit, voice, and slot card taps
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
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: '' };
                return updated;
              });
            } else if (event.type === 'token') {
              fullText += event.content;
              setStreamStarted(true);
              setMessages(prev => {
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
              speakText(fullText);
            } else if (event.type === 'error') {
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: event.message || 'Something went wrong. Please try again.' };
                return updated;
              });
            }
          } catch { /* malformed event chunk */ }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => prev.slice(0, -1));
      showToast('Failed to get a response. Please try again.', 'error');
    } finally {
      setIsLoading(false);
      setToolStatus(null);
      setStreamStarted(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendMessage(input);
    setInput('');
  };

  // Handle voice input
  const handleVoiceInput = (transcript: string) => {
    sendMessage(transcript);
  };

  // Handle slot card tap — auto-submits selected time
  const handleSlotSelect = (date: string, time: string) => {
    setSlotCards(null);
    sendMessage(`I'll take the ${time} slot on ${date}`);
  };
  
  return (
    <div className={styles.container}>
      {showSplash && <Splash onRemember={handleRemember} onSkip={handleSkip} />}
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <span className={styles.headerDot} />
          Pavan's Assistant
        </div>
      </header>
      
      <main className={styles.main}>
        <div className={messages.length === 0 ? styles.center : styles.chatWrapper}>
          {messages.length === 0 ? (
            <>
              <h1 className={styles.title}>
                <span>{greeting}</span>
                <span id="rotating-prompt" className={styles.rotatingPrompt}>{currentPrompt}</span>
              </h1>
              
              <div className={styles.buttonGrid}>
                <button
                  className={styles.actionButton}
                  onClick={() => {
                    setInput("I'd like to schedule a meeting with Pavan");
                    setTimeout(() => {
                      const event = { preventDefault: () => {} } as React.FormEvent;
                      handleSubmit(event);
                    }, 100);
                  }}
                >
                  <div className={styles.buttonContent}>
                    <div className={styles.buttonIcon}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 2V5" stroke="white" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M16 2V5" stroke="white" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M3.5 9.09H20.5" stroke="white" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M21 8.5V17C21 20 19.5 22 16 22H8C4.5 22 3 20 3 17V8.5C3 5.5 4.5 3.5 8 3.5H16C19.5 3.5 21 5.5 21 8.5Z" stroke="white" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M15.6947 13.7H15.7037" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M15.6947 16.7H15.7037" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M11.9955 13.7H12.0045" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M11.9955 16.7H12.0045" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M8.29431 13.7H8.30329" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M8.29431 16.7H8.30329" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div>
                      <div className={styles.buttonTitle}>Set up appointments</div>
                      <div className={styles.buttonDesc}>Schedule a meeting with Pavan</div>
                    </div>
                  </div>
                </button>
                
                <button
                  className={styles.actionButton}
                  onClick={() => {
                    setInput("I'd like to send a message to Pavan");
                    setTimeout(() => {
                      const event = { preventDefault: () => {} } as React.FormEvent;
                      handleSubmit(event);
                    }, 100);
                  }}
                >
                  <div className={styles.buttonContent}>
                    <div className={styles.buttonIcon}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22 10V13C22 17 20 19 16 19H15.5C15.19 19 14.89 19.15 14.7 19.4L13.2 21.4C12.54 22.28 11.46 22.28 10.8 21.4L9.3 19.4C9.14 19.18 8.77 19 8.5 19H8C4 19 2 18 2 13V8C2 4 4 2 8 2H14" stroke="white" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M19.5 7C20.8807 7 22 5.88071 22 4.5C22 3.11929 20.8807 2 19.5 2C18.1193 2 17 3.11929 17 4.5C17 5.88071 18.1193 7 19.5 7Z" stroke="white" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M15.9965 11H16.0054" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M11.9955 11H12.0045" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M7.99451 11H8.00349" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div>
                      <div className={styles.buttonTitle}>Send a message</div>
                      <div className={styles.buttonDesc}>Contact Pavan directly</div>
                    </div>
                  </div>
                </button>
                
                <button 
                  className={styles.actionButton}
                  onClick={() => {
                    setInput("Tell me about Pavan's services and expertise");
                    setTimeout(() => {
                      const event = { preventDefault: () => {} } as React.FormEvent;
                      handleSubmit(event);
                    }, 100);
                  }}
                >
                  <div className={styles.buttonContent}>
                    <div className={styles.buttonIcon}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M12 8V13" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M11.9946 16H12.0036" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div>
                      <div className={styles.buttonTitle}>Get information</div>
                      <div className={styles.buttonDesc}>Learn about Pavan's Projects?</div>
                    </div>
                  </div>
                </button>
                
                <button 
                  className={styles.actionButton}
                  onClick={() => {
                    setInput("What topics do you know about?");
                    setTimeout(() => {
                      const event = { preventDefault: () => {} } as React.FormEvent;
                      handleSubmit(event);
                    }, 100);
                  }}
                >
                  <div className={styles.buttonContent}>
                    <div className={styles.buttonIcon}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22 16.7399V4.66994C22 3.46994 21.02 2.57994 19.83 2.67994H19.77C17.67 2.85994 14.48 3.92994 12.7 5.04994L12.53 5.15994C12.24 5.33994 11.76 5.33994 11.47 5.15994L11.22 5.00994C9.44 3.89994 6.26 2.83994 4.16 2.66994C2.97 2.56994 2 3.46994 2 4.65994V16.7399C2 17.6999 2.78 18.5999 3.74 18.7199L4.03 18.7599C6.2 19.0499 9.55 20.1499 11.47 21.1999L11.51 21.2199C11.78 21.3699 12.21 21.3699 12.47 21.2199C14.39 20.1599 17.75 19.0499 19.93 18.7599L20.26 18.7199C21.22 18.5999 22 17.6999 22 16.7399Z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M12 5.48999V20.49" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M7.75 8.48999H5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M8.5 11.49H5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div>
                      <div className={styles.buttonTitle}>Learn something</div>
                      <div className={styles.buttonDesc}>Discover The Tejavath</div>
                    </div>
                  </div>
                </button>
              </div>
            </>
          ) : (
            <div className={styles.chatContainer}>
              {/* Confetti overlay on booking confirmation */}
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
                // Skip empty non-loading assistant messages
                if (!isUser && !message.content && !isLastAssistant) return null;
                return (
                  <div key={index} className={`${styles.messageRow} ${isUser ? styles.userRow : styles.assistantRow}`}>
                    <div className={styles.messageInner}>
                      {!isUser && <div className={styles.aiAvatar}>P</div>}
                      <div className={isUser ? styles.userBody : styles.assistantBody}>
                        {isUser ? (
                          message.content
                        ) : isThinking ? (
                          <div className={styles.thinkingPill}>
                            <span className={styles.thinkingLabel}>Thinking</span>
                            <span className={styles.statusDots}><span/><span/><span/></span>
                          </div>
                        ) : hasToolStatus ? (
                          <div className={styles.toolStatus}>
                            <span className={styles.toolStatusIcon}>{toolStatus!.icon}</span>
                            <span className={styles.toolStatusLabel}>{toolStatus!.label}</span>
                            <span className={styles.statusDots}><span/><span/><span/></span>
                          </div>
                        ) : (
                          <div className={isStreaming ? styles.streamingText : ''}>
                            <ReactMarkdown>{message.content}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Tappable slot cards */}
              {slotCards && !isLoading && (
                <div className={styles.assistantRow}>
                  <div className={styles.messageInner}>
                    <div className={styles.aiAvatarSpacer} />
                    <div className={styles.slotCardsSection}>
                      <p className={styles.slotCardsLabel}>Pick a slot for {slotCards.date}:</p>
                      <div className={styles.slotCardsRow}>
                        {slotCards.slots.slice(0, 9).map((slot) => (
                          <button
                            key={slot.time}
                            className={styles.slotCard}
                            onClick={() => handleSlotSelect(slotCards.date, slot.time)}
                          >
                            {slot.time} <span className={styles.slotCardIST}>IST</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Booking confirmation card */}
              {bookingCard && (
                <div className={styles.assistantRow}>
                  <div className={styles.messageInner}>
                    <div className={styles.aiAvatarSpacer} />
                    <div className={styles.bookingCard}>
                      <div className={styles.bookingCardHeader}>
                        <span className={styles.bookingCardCheck}>✓</span> Booking Confirmed
                      </div>
                      <div className={styles.bookingCardRow}><span>📅</span>{bookingCard.date} · {bookingCard.time} IST</div>
                      <div className={styles.bookingCardRow}><span>👤</span>{bookingCard.name}</div>
                      <div className={styles.bookingCardRow}><span>📧</span>{bookingCard.email}</div>
                      {bookingCard.eventLink && (
                        <a href={bookingCard.eventLink} target="_blank" rel="noreferrer" className={styles.bookingCardLink}>
                          Open in Google Calendar →
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
          
          <div className={styles.inputContainer}>
            <form onSubmit={handleSubmit}>
              <div className={styles.inputWrapper}>
                <textarea 
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask anything"
                  className={styles.inputField}
                  rows={1}
                  disabled={isLoading}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                />
                <div className={styles.inputActions}>
                  <VoiceButton 
                    onTextCaptured={handleVoiceInput} 
                    disabled={isLoading}
                  />
                  <button 
                    type="submit" 
                    className={`${styles.sendButton} ${input.trim() ? styles.sendButtonActive : ''}`} 
                    disabled={!input.trim() || isLoading}
                    aria-label="Send message"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7.39999 6.32003L15.89 3.49003C19.7 2.22003 21.77 4.30003 20.51 8.11003L17.68 16.6C15.78 22.31 12.66 22.31 10.76 16.6L9.91999 14.08L7.39999 13.24C1.68999 11.34 1.68999 8.23003 7.39999 6.32003Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M10.11 13.6501L13.69 10.0601" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
        
        <footer className={styles.footer}>
          I am The Tejavath's Assistant. I can't make any mistakes! ;)
          Developed by Pavan Tejavath.
        </footer>
      </main>
      
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
      
      {/* Toast notifications */}
      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.visible}
        onClose={hideToast}
      />
    </div>
  );
}
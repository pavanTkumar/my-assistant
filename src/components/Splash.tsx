'use client';

import React, { useEffect, useRef, useState } from 'react';
import Flame from './Flame';
import styles from './Splash.module.css';

type Props = {
  // Called when the user continues WITH remembering (persist to Redis).
  onRemember: (name: string) => void;
  // Called when the user skips / declines the cookie. Optional name = session-only.
  onSkip: (name?: string) => void;
};

// The Tejavath — welcome / identity screen (screen 01). Full-page, not a modal.
export default function Splash({ onRemember, onSkip }: Props) {
  const [name, setName] = useState('');
  const [pressed, setPressed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 500);
    return () => clearTimeout(t);
  }, []);

  const finish = (fn: () => void) => {
    setLeaving(true);
    // Let the exit transition play before unmounting.
    setTimeout(fn, 300);
  };

  const handleRemember = () => {
    const n = name.trim();
    if (!n) {
      inputRef.current?.focus();
      return;
    }
    finish(() => onRemember(n));
  };

  const handleSkip = () => finish(() => onSkip(name.trim() || undefined));

  return (
    <div
      className={`${styles.shell} ${leaving ? styles.leaving : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome"
    >
      <div className={styles.gridBg} aria-hidden />

      {/* meta bar */}
      <div className={styles.metaBar}>
        <div className={styles.metaLeft}>
          <span className={styles.mark}>
            <Flame size={15} />
          </span>
          <span>P. TEJAVATH — VIRTUAL ASSISTANT</span>
        </div>
        <div className={styles.metaRight}>
          <span className={styles.onlineDot} />
          <span>ONLINE</span>
        </div>
      </div>

      <div className={styles.scanLine} aria-hidden />

      <div className={styles.center}>
        <div className={styles.logo}>
          <span className={styles.logoFlame}>
            <Flame size={30} />
          </span>
          <span className={styles.wordmark}>THE&nbsp;TEJAVATH</span>
        </div>

        <div className={styles.indexLabel}>
          <span className={styles.indexRule} />
          01 / IDENTITY
        </div>

        <div className={styles.tagline}>I&apos;m Pavan&apos;s assistant.</div>

        <h1 className={styles.headline}>What should I call you?</h1>

        <div className={styles.inputZone}>
          <input
            ref={inputRef}
            className={styles.bigInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRemember()}
            placeholder="type your name"
            maxLength={60}
            aria-label="Your name"
          />
          <div className={styles.underline} />
        </div>

        <div className={styles.actions}>
          <button
            className={`${styles.continueBtn} ${pressed ? styles.pressed : ''}`}
            onClick={handleRemember}
            onMouseDown={() => setPressed(true)}
            onMouseUp={() => setPressed(false)}
            onMouseLeave={() => setPressed(false)}
          >
            <span>Continue</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
          <button className={styles.skipBtn} onClick={handleSkip}>
            Skip — don&apos;t remember me
          </button>
        </div>
      </div>

      <div className={styles.foot}>
        <span className={styles.footRule} />
        We store a small cookie only to greet you by name during your visit. Nothing else is
        collected. “Skip” keeps your name for this session only.
      </div>
    </div>
  );
}

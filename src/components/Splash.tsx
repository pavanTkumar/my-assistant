'use client';

import React, { useEffect, useRef, useState } from 'react';
import styles from './Splash.module.css';

type Props = {
  // Called when the user continues WITH remembering (persist to Redis).
  onRemember: (name: string) => void;
  // Called when the user skips / declines the cookie. Optional name = session-only.
  onSkip: (name?: string) => void;
};

export default function Splash({ onRemember, onSkip }: Props) {
  const [name, setName] = useState('');
  const [leaving, setLeaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 500);
    return () => clearTimeout(t);
  }, []);

  const finish = (fn: () => void) => {
    setLeaving(true);
    // Let the exit animation play before unmounting.
    setTimeout(fn, 420);
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
    <div className={`${styles.overlay} ${leaving ? styles.leaving : ''}`} role="dialog" aria-modal="true" aria-label="Welcome">
      {/* subtle floating orbs — placeholder physics, refine later */}
      <span className={`${styles.orb} ${styles.orb1}`} aria-hidden />
      <span className={`${styles.orb} ${styles.orb2}`} aria-hidden />
      <span className={`${styles.orb} ${styles.orb3}`} aria-hidden />

      <div className={styles.card}>
        <div className={styles.badge} aria-hidden>PT</div>
        <h1 className={styles.heading}>Hi there 👋</h1>
        <p className={styles.sub}>I&apos;m Pavan&apos;s assistant. What should I call you?</p>

        <input
          ref={inputRef}
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleRemember()}
          placeholder="Your name"
          maxLength={60}
          aria-label="Your name"
        />

        <button className={styles.primary} onClick={handleRemember}>
          Continue
        </button>
        <button className={styles.ghost} onClick={handleSkip}>
          Skip — don&apos;t remember me
        </button>

        <p className={styles.consent}>
          We store a small cookie only to greet you by name during your visit. Nothing else
          is collected or saved. Choosing “Skip” keeps your name for this session only.
        </p>
      </div>
    </div>
  );
}

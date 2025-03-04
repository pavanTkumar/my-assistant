import React, { useState, useEffect, useRef } from 'react';
import styles from './VoiceButton.module.css';
import { startSpeechRecognition, stopSpeechRecognition } from '@/lib/speech';

interface VoiceButtonProps {
  onTextCaptured: (text: string) => void;
  disabled?: boolean;
}

const VoiceButton: React.FC<VoiceButtonProps> = ({ onTextCaptured, disabled = false }) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [volume, setVolume] = useState(0);
  
  const recognitionRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        stopSpeechRecognition(recognitionRef.current);
      }
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);
  
  // Microphone animation effect
  useEffect(() => {
    let lastTime = 0;
    
    const animateMicrophone = (time: number) => {
      if (time - lastTime > 100) {
        lastTime = time;
        if (isListening) {
          setVolume(0.3 + Math.random() * 0.7);
        }
      }
      
      if (isListening) {
        animationFrameRef.current = requestAnimationFrame(animateMicrophone);
      }
    };
    
    if (isListening) {
      animationFrameRef.current = requestAnimationFrame(animateMicrophone);
    } else {
      setVolume(0);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isListening]);
  
  const handleToggleListening = () => {
    if (disabled) return;
    
    if (isListening) {
      // Stop listening
      if (recognitionRef.current) {
        stopSpeechRecognition(recognitionRef.current);
        recognitionRef.current = null;
      }
      setIsListening(false);
      
      // If we have a transcript, pass it to the parent
      if (transcript.trim()) {
        onTextCaptured(transcript);
      }
      
      // Reset transcript
      setTranscript('');
    } else {
      // Start listening
      setError('');
      setTranscript('');
      
      const recognition = startSpeechRecognition(
        // On transcript (interim results)
        (text) => {
          setTranscript(text);
        },
        // On final result
        (finalText) => {
          setTranscript(finalText);
          setIsListening(false);
          onTextCaptured(finalText);
          recognitionRef.current = null;
        },
        // On error
        (errorMessage) => {
          setError(errorMessage);
          setIsListening(false);
          recognitionRef.current = null;
        }
      );
      
      if (recognition) {
        recognitionRef.current = recognition;
        setIsListening(true);
      }
    }
  };
  
  return (
    <div className={styles.container}>
      <button 
        type="button"
        className={`${styles.voiceButton} ${isListening ? styles.listening : ''} ${disabled ? styles.disabled : ''}`}
        onClick={handleToggleListening}
        disabled={disabled}
        aria-label={isListening ? "Stop listening" : "Start voice input"}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" x2="12" y1="19" y2="22"></line>
        </svg>
      </button>
      
      {isListening && (
        <>
          <div 
            className={styles.ring} 
            style={{ transform: `scale(${0.8 + volume * 0.5})` }}
          ></div>
          <div 
            className={styles.outerRing} 
            style={{ transform: `scale(${1 + volume * 0.8})` }}
          ></div>
        </>
      )}
      
      {transcript && isListening && (
        <div className={styles.transcriptPopup}>
          <p>{transcript}</p>
        </div>
      )}
      
      {error && (
        <div className={styles.errorPopup}>
          <p>{error}</p>
        </div>
      )}
    </div>
  );
};

export default VoiceButton;
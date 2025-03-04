// Create this file at: src/types/web-speech.d.ts

// Define SpeechRecognition interfaces
interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
    onerror: ((this: SpeechRecognition, ev: any) => any) | null;
    onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  }
  
  interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
  }
  
  interface SpeechRecognitionResultList {
    [index: number]: SpeechRecognitionResult;
    length: number;
  }
  
  interface SpeechRecognitionResult {
    [index: number]: SpeechRecognitionAlternative;
    isFinal: boolean;
    length: number;
  }
  
  interface SpeechRecognitionAlternative {
    confidence: number;
    transcript: string;
  }
  
  interface SpeechRecognitionStatic {
    new(): SpeechRecognition;
    prototype: SpeechRecognition;
  }
  
  // Add to Window interface globally
  declare global {
    interface Window {
      SpeechRecognition?: SpeechRecognitionStatic;
      webkitSpeechRecognition?: SpeechRecognitionStatic;
    }
  }
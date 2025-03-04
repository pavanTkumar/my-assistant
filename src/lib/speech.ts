// Types for browser speech APIs
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
  
  // Create a proper type for SpeechRecognition
  interface SpeechRecognitionInstance extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => any) | null;
    onerror: ((this: SpeechRecognitionInstance, ev: any) => any) | null;
    onend: ((this: SpeechRecognitionInstance, ev: Event) => any) | null;
  }
  
  // Start speech recognition
  export const startSpeechRecognition = (
    onTranscript: (text: string) => void,
    onFinal: (text: string) => void,
    onError: (error: string) => void
  ) => {
    // Check if browser supports Speech Recognition
    if (typeof window === 'undefined') return null;
    
    // Fix: Use type assertion to avoid TypeScript error
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      onError('Speech recognition is not supported in this browser. Try Chrome, Edge, or Safari.');
      return null;
    }
    
    // Create recognition instance
    const recognition = new SpeechRecognition();
    
    // Configure
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    
    // Handle results
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('');
      
      onTranscript(transcript);
      
      // Check if result is final
      if (event.results[0].isFinal) {
        onFinal(transcript);
      }
    };
    
    // Handle errors
    recognition.onerror = (event: any) => {
      onError(`Speech recognition error: ${event.error}`);
    };
    
    // Start recognition
    try {
      recognition.start();
    } catch (error) {
      onError('Could not start speech recognition.');
      return null;
    }
    
    return recognition;
  };
  
  // Stop speech recognition
  export const stopSpeechRecognition = (recognition: any) => {
    if (recognition) {
      try {
        recognition.stop();
      } catch (error) {
        console.error('Error stopping speech recognition:', error);
      }
    }
  };
  
  // Text-to-speech (speaking)
  export const speakText = (text: string, onStart?: () => void, onEnd?: () => void) => {
    // Check if browser supports speech synthesis
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      console.error('Speech synthesis not supported');
      return false;
    }
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    // Create utterance
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Configure voice
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    // Find a good voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(voice =>
      voice.name.includes('Google') ||
      voice.name.includes('Natural') ||
      voice.name.includes('Samantha')
    );
    
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }
    
    // Set event handlers
    if (onStart) utterance.onstart = onStart;
    if (onEnd) utterance.onend = onEnd;
    
    // Speak
    window.speechSynthesis.speak(utterance);
    return true;
  };
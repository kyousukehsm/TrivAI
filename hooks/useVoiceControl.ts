import { useState, useEffect, useRef } from 'react';
import { GameState } from '../types';

export interface VoiceControlHandlers {
  onAnswer: (index: number) => void;
  onNext: () => void;
  onStart: () => void;
  onExit: () => void;
}

export function useVoiceControl(
  gameState: GameState,
  handlers: VoiceControlHandlers,
  enabled: boolean
) {
  const [isListening, setIsListening] = useState(false);
  const [lastCommand, setLastCommand] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  
  const recognitionRef = useRef<any>(null);
  const handlersRef = useRef(handlers);
  const gameStateRef = useRef(gameState);
  const enabledRef = useRef(enabled);
  const restartTimerRef = useRef<any>(null);
  const recentErrorRef = useRef<string | null>(null);

  // Keep refs updated
  useEffect(() => {
    handlersRef.current = handlers;
    gameStateRef.current = gameState;
    enabledRef.current = enabled;
  }, [handlers, gameState, enabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Check support
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice control not supported");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true; 
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      if (!enabledRef.current) return;

      const last = event.results.length - 1;
      const result = event.results[last];
      if (!result.isFinal) return; 

      const text = result[0].transcript.trim().toLowerCase();
      console.log("Voice Command Detected:", text);
      setLastCommand(text);
      setError(null); // Clear errors on success
      recentErrorRef.current = null;

      const h = handlersRef.current;
      const gs = gameStateRef.current;

      // Global Commands
      if (text.includes('exit') || text.includes('quit') || text.includes('stop game')) {
          h.onExit();
          return;
      }

      if (gs === GameState.SETUP) {
          if (text.includes('start') || text.includes('begin') || text.includes('play') || text.includes('go')) {
              h.onStart();
          }
      } 
      else if (gs === GameState.PLAYING) {
          // Loose matching for options
          if (/(^|\s)a($|\s)|option a|first/.test(text)) h.onAnswer(0);
          else if (/(^|\s)b($|\s)|option b|second/.test(text)) h.onAnswer(1);
          else if (/(^|\s)c($|\s)|option c|third/.test(text)) h.onAnswer(2);
          else if (/(^|\s)d($|\s)|option d|fourth/.test(text)) h.onAnswer(3);
      } 
      else if (gs === GameState.RESULT) {
          if (text.includes('next') || text.includes('continue') || text.includes('ready') || text.includes('okay')) {
              h.onNext();
          }
      }
    };

    recognition.onstart = () => {
        console.log("Recognition started");
        setIsListening(true);
        setError(null);
    };
    
    recognition.onend = () => {
        console.log("Recognition ended");
        setIsListening(false);
        
        // Auto-restart if enabled
        if (enabledRef.current) {
            clearTimeout(restartTimerRef.current);
            
            // Backoff: if network error, wait longer (2s), otherwise short (0.3s)
            const delay = recentErrorRef.current === 'network' ? 2000 : 300;
            
            restartTimerRef.current = setTimeout(() => {
                try { 
                    if (enabledRef.current) {
                        console.log("Attempting restart...");
                        recognition.start(); 
                    }
                } catch (e) { 
                    console.debug("Restart failed", e); 
                }
            }, delay);
        }
    };
    
    recognition.onerror = (e: any) => {
        recentErrorRef.current = e.error;

        if (e.error === 'not-allowed') {
            console.error("Recognition permission error");
            setError("Microphone access denied. Please check your browser settings.");
            enabledRef.current = false;
        } else if (e.error === 'network') {
            console.warn("Recognition network error");
            setError("Reconnecting...");
        } else if (e.error === 'no-speech') {
            // Ignore no-speech errors, they just mean silence
        } else if (e.error === 'aborted') {
            // Ignore aborted
        } else {
             console.error("Recognition error", e.error);
             setError(`Voice Error: ${e.error}`);
        }
    };

    recognitionRef.current = recognition;

    return () => {
        enabledRef.current = false;
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch(e) {}
        }
        clearTimeout(restartTimerRef.current);
    };
  }, []);

  // Manage Start/Stop logic
  useEffect(() => {
      const rec = recognitionRef.current;
      if (!rec) return;

      if (enabled) {
          try { 
             rec.start(); 
          } catch (e) {
              // safe to ignore "already started"
          }
      } else {
          try { rec.stop(); } catch(e) {}
      }
  }, [enabled]);

  return { isListening, lastCommand, error };
}
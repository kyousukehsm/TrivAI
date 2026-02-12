import { useEffect, useRef, useState, useCallback } from 'react';

// Royalty-free ambient track (Lofi Chill)
const BGM_URL = 'https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf07a.mp3'; 

export const useSound = (shouldDuck: boolean) => {
  const [isMuted, setIsMuted] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const bgmRef = useRef<HTMLAudioElement | null>(null);

  // Initialize Audio Context for SFX
  const initContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }
    return audioContextRef.current;
  }, []);

  // Initialize BGM
  useEffect(() => {
    const audio = new Audio(BGM_URL);
    audio.loop = true;
    audio.volume = 0.2;
    // Preload
    audio.load();
    bgmRef.current = audio;

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Handle Ducking (Fade out when host speaks, Fade in when silent)
  useEffect(() => {
    if (!bgmRef.current || isMuted) return;
    
    // Target volume: Lower when ducking, Normal when not
    const targetVolume = shouldDuck ? 0.05 : 0.2;
    const interval = 50; // ms
    const step = 0.02;   // volume change per step
    
    const fade = setInterval(() => {
        if (!bgmRef.current) { clearInterval(fade); return; }
        
        const current = bgmRef.current.volume;
        const diff = targetVolume - current;

        if (Math.abs(diff) < step) {
            bgmRef.current.volume = targetVolume;
            clearInterval(fade);
        } else {
            bgmRef.current.volume = current + (diff > 0 ? step : -step);
        }
    }, interval);

    return () => clearInterval(fade);
  }, [shouldDuck, isMuted]);

  // Handle Mute Toggle
  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
        const next = !prev;
        if (bgmRef.current) {
            if (next) {
                bgmRef.current.pause();
            } else {
                bgmRef.current.play().catch(e => console.debug("Resume BGM failed", e));
            }
        }
        return next;
    });
  }, []);
  
  // Start music on first user interaction
  const enableAudio = useCallback(() => {
      initContext();
      if (!isMuted && bgmRef.current && bgmRef.current.paused) {
          const playPromise = bgmRef.current.play();
          if (playPromise !== undefined) {
              playPromise.catch(e => {
                  console.debug("Auto-play prevented (waiting for interaction)", e);
              });
          }
      }
  }, [isMuted, initContext]);

  // Synthesize SFX using AudioContext (No external files required)
  const playSfx = useCallback((type: 'correct' | 'incorrect' | 'click' | 'win' | 'start' | 'hover') => {
      if (isMuted) return;
      const ctx = initContext();
      const t = ctx.currentTime;
      
      const createOsc = (freq: number, type: OscillatorType, startTime: number, duration: number, vol: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(freq, startTime);
          
          gain.gain.setValueAtTime(vol, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.start(startTime);
          osc.stop(startTime + duration);
          return { osc, gain };
      };

      switch (type) {
        case 'correct':
            createOsc(600, 'sine', t, 0.1, 0.1);
            createOsc(900, 'sine', t + 0.1, 0.2, 0.1);
            break;
        case 'incorrect':
            const { osc, gain } = createOsc(200, 'sawtooth', t, 0.4, 0.1);
            osc.frequency.linearRampToValueAtTime(50, t + 0.4); // Slide down
            break;
        case 'click':
            createOsc(800, 'sine', t, 0.05, 0.05);
            break;
        case 'hover':
            createOsc(400, 'sine', t, 0.03, 0.02);
            break;
        case 'start':
            createOsc(400, 'triangle', t, 0.1, 0.1);
            createOsc(600, 'triangle', t + 0.1, 0.3, 0.1);
            createOsc(800, 'triangle', t + 0.2, 0.4, 0.1);
            break;
        case 'win':
             // C Major chord arpeggio
            [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
                createOsc(freq, 'square', t + (i * 0.1), 0.4, 0.05);
            });
            break;
      }
  }, [isMuted, initContext]);

  return { isMuted, toggleMute, enableAudio, playSfx };
};

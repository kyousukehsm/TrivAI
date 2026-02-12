
import React, { useEffect, useState, useRef } from 'react';
import { Personality, TraitConfig } from '../types';
import { LiveClient } from '../services/live';
import AudioVisualizer from './Visualizer';
import { Mic, MicOff, X, MessageSquare, Loader2 } from 'lucide-react';

interface Props {
  personality: Personality;
  traits: TraitConfig;
  onClose: () => void;
}

interface Transcript {
  text: string;
  isUser: boolean;
  id: number;
}

const LiveChat: React.FC<Props> = ({ personality, traits, onClose }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const liveClientRef = useRef<LiveClient | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Init Audio Context for playback
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    audioContextRef.current = ctx;

    const client = new LiveClient({
      apiKey: process.env.API_KEY || '',
      personality,
      traits,
      onAudioData: (buffer) => {
        if (!audioContextRef.current) return;
        
        const ctx = audioContextRef.current;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        
        // Schedule gapless playback
        const currentTime = ctx.currentTime;
        // Ensure we don't schedule in the past
        if (nextStartTimeRef.current < currentTime) {
            nextStartTimeRef.current = currentTime;
        }
        
        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += buffer.duration;
      },
      onTranscription: (text, isUser) => {
        setTranscripts(prev => {
            // Check if we should merge with the last message
            const last = prev[prev.length - 1];
            
            // If the last message belongs to the same speaker, append the text chunk (delta)
            if (last && last.isUser === isUser) {
                const updated = { ...last, text: last.text + text };
                // Return new array with the last item replaced
                return [...prev.slice(0, -1), updated];
            }
            
            // Otherwise, start a new message bubble
            return [...prev, { text, isUser, id: Date.now() }];
        });
      },
      onError: (err) => setError(err.message),
      onClose: () => setIsConnected(false),
    });

    liveClientRef.current = client;
    client.connect().then(() => setIsConnected(true));

    return () => {
      client.disconnect();
      if (audioContextRef.current) {
          audioContextRef.current.close();
      }
    };
  }, [personality, traits]);

  // Auto-scroll to bottom on new text
  useEffect(() => {
    if (transcriptContainerRef.current) {
        transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcripts]);

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto p-4 animate-fadeIn">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
          <span className="text-4xl">{personality.avatar}</span>
          Chatting with {personality.name}
        </h2>
        <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full transition-colors">
          <X className="text-slate-400" />
        </button>
      </div>

      <div className="flex-1 bg-slate-800/50 rounded-2xl p-6 mb-6 flex flex-col relative overflow-hidden border border-slate-700">
        {!isConnected && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-10">
                <div className="text-center">
                    <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mx-auto mb-2" />
                    <p className="text-slate-300">Connecting to Live Host...</p>
                </div>
            </div>
        )}
        
        {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 z-20">
                <div className="text-center text-red-400 p-4">
                    <p className="font-bold mb-2">Connection Error</p>
                    <p className="text-sm">{error}</p>
                    <button 
                        onClick={onClose}
                        className="mt-4 px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600"
                    >
                        Go Back
                    </button>
                </div>
            </div>
        )}

        {/* Transcripts Area */}
        <div 
            ref={transcriptContainerRef}
            className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2"
        >
            {transcripts.length === 0 && isConnected && (
                <p className="text-center text-slate-500 italic mt-10">
                    Say "Hello" to start the conversation!
                </p>
            )}
            {transcripts.map((t) => (
                <div key={t.id} className={`flex ${t.isUser ? 'justify-end' : 'justify-start'} animate-fadeIn`}>
                    <div className={`max-w-[85%] rounded-2xl px-5 py-3 shadow-sm ${
                        t.isUser 
                        ? 'bg-cyan-600/20 border border-cyan-500/30 text-cyan-50 rounded-tr-sm' 
                        : 'bg-slate-700/50 border border-slate-600/50 text-slate-100 rounded-tl-sm'
                    }`}>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{t.text}</p>
                    </div>
                </div>
            ))}
        </div>

        {/* Visualizer at bottom of chat card */}
        <div className="mt-auto">
            <AudioVisualizer isActive={isConnected} accentColor="#22d3ee" />
        </div>
      </div>

      <div className="flex justify-center items-center gap-4 text-slate-400 text-sm">
        <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
        {isConnected ? 'Microphone Active' : 'Disconnected'}
      </div>
    </div>
  );
};

export default LiveChat;

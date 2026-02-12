
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { Personality, TraitConfig } from "../types";
import { createBlob, pcmToAudioBuffer } from "../utils/audio";

export interface LiveClientConfig {
  apiKey: string;
  personality: Personality;
  traits: TraitConfig;
  onAudioData: (buffer: AudioBuffer) => void;
  onError: (error: Error) => void;
  onClose: () => void;
  onTranscription?: (text: string, isUser: boolean) => void;
}

export class LiveClient {
  private ai: GoogleGenAI;
  private config: LiveClientConfig;
  private session: any = null; // Session type isn't fully exported in simple form, using any for now
  private inputAudioContext: AudioContext;
  private outputAudioContext: AudioContext;
  private micStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private isConnected: boolean = false;

  constructor(config: LiveClientConfig) {
    this.config = config;
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }

  async connect() {
    try {
      // Setup Mic first
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const { traits, personality } = this.config;
      
      let traitInstructions = "";
      if (traits.humor < 30) traitInstructions += " Be serious and factual.";
      else if (traits.humor > 70) traitInstructions += " Be very funny and joke around.";
      
      if (traits.verbosity < 30) traitInstructions += " Keep answers very short.";
      else if (traits.verbosity > 70) traitInstructions += " Be detailed and chatty.";
      
      if (traits.sarcasm > 70) traitInstructions += " Be sassy and use sarcasm.";
      else if (traits.sarcasm < 30) traitInstructions += " Be very warm and polite.";

      const sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: async () => {
            console.log("Live Session Connected");
            this.isConnected = true;
            await this.startMicStream(sessionPromise);
          },
          onmessage: (msg: LiveServerMessage) => this.handleMessage(msg),
          onclose: (e) => {
            console.log("Live Session Closed", e);
            this.isConnected = false;
            this.config.onClose();
          },
          onerror: (e: any) => {
            console.error("Live Session Error", e);
            // Extract meaningful error message if possible
            const msg = e instanceof Error ? e.message : (e?.message || "Connection Error");
            this.config.onError(new Error(msg));
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.personality.voiceName } }
          },
          // Enhanced System Instruction for "Higher Intelligence" and Character Consistency
          systemInstruction: { 
            parts: [{ text: `
              You are ${personality.name}, the host of the TrivAI game.
              YOUR PERSONA: ${personality.prompt}
              
              CONTEXT: You are currently in a "Live Chat" mode with the player. This is a real-time voice conversation.
              
              INSTRUCTIONS:
              1. ${traitInstructions}
              2. Keep responses concise (1-3 sentences) suitable for voice.
              3. Be witty, intelligent, engaging, and react naturally to what the user says.
              4. If the user asks about the game, explain you are the host.
              5. Do not hallucinate game states (e.g., do not say "Question 1 is..." unless you actually generated one, which you haven't in this mode).
              6. Focus on the conversation flow.
            ` }] 
          },
          inputAudioTranscription: {}, 
          outputAudioTranscription: {}
        }
      });
      
      this.session = sessionPromise;
      
      // Await session establishment to catch initial connection errors (e.g. 4xx/5xx)
      await sessionPromise;

    } catch (err) {
      console.error("Connection setup failed", err);
      this.config.onError(err as Error);
      this.disconnect();
    }
  }

  private async startMicStream(sessionPromise: Promise<any>) {
    if (!this.micStream) return;
    
    // Ensure context is active
    if (this.inputAudioContext.state === 'suspended') {
      await this.inputAudioContext.resume();
    }

    this.source = this.inputAudioContext.createMediaStreamSource(this.micStream);
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      // Only send if connected to avoid errors accumulating
      if (!this.isConnected) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const blob = createBlob(inputData);
      
      sessionPromise.then(session => {
        try {
          session.sendRealtimeInput({ media: blob });
        } catch (sendError) {
          console.error("Error sending audio chunk", sendError);
        }
      });
    };

    this.source.connect(this.processor);
    this.processor.connect(this.inputAudioContext.destination);
  }

  private async handleMessage(message: LiveServerMessage) {
    // Handle Audio
    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData) {
      try {
        if (this.outputAudioContext.state === 'suspended') {
            await this.outputAudioContext.resume();
        }
        const buffer = pcmToAudioBuffer(audioData, this.outputAudioContext);
        this.config.onAudioData(buffer);
      } catch (e) {
        console.error("Error decoding live audio chunk", e);
      }
    }

    // Handle Transcriptions (Send Deltas)
    if (message.serverContent?.outputTranscription?.text) {
        this.config.onTranscription?.(message.serverContent.outputTranscription.text, false);
    }
    if (message.serverContent?.inputTranscription?.text) {
        this.config.onTranscription?.(message.serverContent.inputTranscription.text, true);
    }
  }

  disconnect() {
    this.isConnected = false;

    if (this.session) {
        // We can't cancel the promise, but we can try to close the session if it resolved
        this.session.then((s: any) => {
            try { s.close(); } catch(e) { console.debug("Session close error", e); }
        }).catch(() => {});
        this.session = null;
    }
    
    // Stop Mic
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    
    // Suspend or Close contexts
    try {
      if (this.inputAudioContext.state !== 'closed') this.inputAudioContext.close();
      if (this.outputAudioContext.state !== 'closed') this.outputAudioContext.close();
    } catch (e) { console.debug("AudioContext close error", e); }
  }
}

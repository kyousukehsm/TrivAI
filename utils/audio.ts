export const createAudioContext = (sampleRate: number) => {
  return new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate });
};

export const decodeAudioData = async (
  base64String: string,
  ctx: AudioContext
): Promise<AudioBuffer> => {
  const binaryString = atob(base64String);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // For Gemini TTS/Live API, raw PCM is often returned directly or wrapped.
  // Standard decodeAudioData usually expects headers (WAV/MP3). 
  // However, Gemini Live API sends raw PCM (no headers).
  // Gemini TTS (Rest API) sends raw audio bytes usually. 
  // We will assume raw PCM for Live and verify for TTS. 
  
  // Actually, for the REST API (TTS), the response is base64 encoded audio content.
  // It is usually containerized (MP3) or raw depending on config.
  // The default TTS from Gemini is often MP3 or WAV if not specified as PCM.
  // But Live API is strictly PCM.
  
  // Let's implement a safe decoder that tries standard decode first.
  try {
     return await ctx.decodeAudioData(bytes.buffer.slice(0)); // Copy buffer to avoid detachment issues
  } catch (e) {
     // If standard decode fails, it might be raw PCM (for Live API especially)
     // But Live API handles decoding manually in the service usually.
     console.error("Audio decode failed", e);
     throw e;
  }
};

// Raw PCM decoder for Live API chunks (16-bit little endian, 24kHz usually)
export const pcmToAudioBuffer = (
  base64String: string,
  ctx: AudioContext,
  sampleRate: number = 24000
): AudioBuffer => {
  const binaryString = atob(base64String);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const dataInt16 = new Int16Array(bytes.buffer);
  const frameCount = dataInt16.length;
  const buffer = ctx.createBuffer(1, frameCount, sampleRate);
  const channelData = buffer.getChannelData(0);

  for (let i = 0; i < frameCount; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
};

// Encode Float32 from AudioContext (mic) to 16-bit PCM for Live API
export const float32ToB64PCM = (float32Array: Float32Array): string => {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    // Clamp values
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  let binary = '';
  const bytes = new Uint8Array(int16Array.buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const createBlob = (data: Float32Array): { data: string, mimeType: string } => {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  
  let binary = '';
  const bytes = new Uint8Array(int16.buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);

  return {
    data: b64,
    mimeType: 'audio/pcm;rate=16000',
  };
}

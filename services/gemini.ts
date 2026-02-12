import { GoogleGenAI, Type, Modality } from "@google/genai";
import { TriviaQuestion, Personality, TraitConfig, Difficulty } from "../types";

const getTraitInstructions = (traits: TraitConfig) => {
  let instructions = [];
  
  if (traits.humor < 30) instructions.push("Maintain a serious, strictly factual tone. Do not make jokes.");
  else if (traits.humor > 70) instructions.push("Be extremely funny, include puns or jokes in the explanation.");
  
  if (traits.verbosity < 30) instructions.push("Keep the explanation extremely short and concise (under 20 words).");
  else if (traits.verbosity > 70) instructions.push("Be very verbose and elaborate in your explanation, adding interesting side details (max 100 words).");
  
  if (traits.sarcasm > 70) instructions.push("Use heavy sarcasm, sass, and a slightly superior tone.");
  else if (traits.sarcasm < 30) instructions.push("Be extremely polite, warm, supportive, and kind.");
  
  return instructions.length ? `\n\nSpecific Behavioral Adjustments:\n${instructions.join("\n")}` : "";
};

const getDifficultyInstructions = (difficulty: Difficulty) => {
  switch (difficulty) {
    case Difficulty.EASY:
      return "Generate a beginner-friendly question based on common general knowledge. The answer should be recognizable to most people.";
    case Difficulty.HARD:
      return "Generate a very difficult, obscure, or expert-level question. Challenge the player with specific details, dates, or lesser-known facts.";
    case Difficulty.MEDIUM:
    default:
      return "Generate a moderately challenging question. It should require some specific knowledge but not be impossibly obscure.";
  }
};

export const generateTriviaQuestion = async (
  apiKey: string,
  topic: string,
  personality: Personality,
  traits: TraitConfig,
  difficulty: Difficulty,
  previousQuestions: string[] = []
): Promise<TriviaQuestion> => {
  if (!apiKey) throw new Error("API Key missing");

  const ai = new GoogleGenAI({ apiKey });
  const traitPrompt = getTraitInstructions(traits);
  const difficultyPrompt = getDifficultyInstructions(difficulty);

  // Construct exclusion list to prevent repeats
  const exclusionPrompt = previousQuestions.length > 0 
    ? `\nIMPORTANT: Do NOT generate any of the following questions (or variations of them) as they have already been asked:\n${previousQuestions.map(q => `- ${q}`).join('\n')}\n`
    : "";

  // Prompt Engineering: stricter JSON instructions without reliance on responseSchema
  const prompt = `
    Generate a unique trivia question about "${topic}".
    ${exclusionPrompt}
    
    DIFFICULTY LEVEL: ${difficulty}
    INSTRUCTION: ${difficultyPrompt}
    
    BASE PERSONALITY: ${personality.prompt}
    ${traitPrompt}
    
    IMPORTANT: 
    1. Use the 'googleSearch' tool to verify the fact and ensure accuracy.
    2. You MUST return the result as a valid, raw JSON object.
    3. Do NOT include markdown formatting (like \`\`\`json).
    4. Do NOT include any conversational text, notes, or explanations outside the JSON object.
    
    JSON Structure:
    {
      "question": "The question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswerIndex": 0,
      "correctResponse": "Host's enthusiastic confirmation of the right answer, followed by a short explanation/fact.",
      "incorrectResponse": "Host's correction (stating the right answer) and a short explanation/fact, possibly offering sympathy or sass depending on personality."
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        maxOutputTokens: 8192,
        // REMOVED responseSchema and responseMimeType to avoid conflict with Google Search tool.
        // We rely on the prompt to enforce JSON format.
      }
    });

    const text = response.text;
    if (!text) throw new Error("No text response from Gemini");

    let data: TriviaQuestion;
    
    // Cleanup: Remove markdown code blocks if present
    let cleanText = text.replace(/```json\n?|```/g, "").trim();

    try {
        data = JSON.parse(cleanText) as TriviaQuestion;
    } catch (parseError) {
        // Robust Extraction Strategy: Find outermost braces
        const firstOpen = cleanText.indexOf('{');
        const lastClose = cleanText.lastIndexOf('}');
        
        if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
            const substring = cleanText.substring(firstOpen, lastClose + 1);
            try {
                data = JSON.parse(substring) as TriviaQuestion;
            } catch (e2) {
                 throw new Error("Failed to parse extracted JSON substring: " + (e2 as Error).message);
            }
        } else {
             console.warn("Raw response text was:", text); // Debug log to see what the model actually returned
             throw new Error("No JSON object found in response");
        }
    }
    
    // VALIDATION
    if (!data || !data.question || !Array.isArray(data.options)) {
      throw new Error("Malformed JSON: Missing question or options array");
    }
    
    if (data.options.length < 2) {
         throw new Error("Malformed JSON: Not enough options provided");
    }

    // Polyfill for backward compatibility if model returns old format (explanation only)
    if ((data as any).explanation && (!data.correctResponse || !data.incorrectResponse)) {
        const exp = (data as any).explanation;
        const correctAnswer = data.options[data.correctAnswerIndex];
        data.correctResponse = `Correct! ${exp}`;
        data.incorrectResponse = `Incorrect. The answer was ${correctAnswer}. ${exp}`;
    }

    // Extract grounding metadata if available
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks && chunks.length > 0) {
      const firstWeb = chunks.find(c => c.web)?.web;
      if (firstWeb) {
        data.sourceUrl = firstWeb.uri;
        data.sourceTitle = firstWeb.title;
      }
    }

    return data;
  } catch (error: any) {
    // Determine log level based on error type
    const errorMsg = error.message || String(error);
    const isQuotaError = error.status === 429 || error.code === 429 || errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');
    const isJsonError = errorMsg.includes("JSON") || errorMsg.includes("SyntaxError");

    if (isQuotaError) {
        console.warn("Gemini API Quota Exceeded. Using fallback question.");
    } else if (isJsonError) {
        console.warn("JSON Parsing Error during question generation. Using fallback.", errorMsg);
    } else {
        // Only log unanticipated errors as actual errors
        console.error("Error generating question:", error);
    }

    // Clean Fallback question if API fails
    return {
      question: "Which coding language is known for its snake logo?",
      options: ["Java", "Python", "C++", "Ruby"],
      correctAnswerIndex: 1,
      correctResponse: "That's right! Python is named after Monty Python, but the logo is a snake.",
      incorrectResponse: "Not quite. It's Python! Named after Monty Python, but represented by a snake."
    };
  }
};

export const generateSpeech = async (apiKey: string, text: string, voiceName: string): Promise<string | null> => {
  if (!apiKey) return null;
  const ai = new GoogleGenAI({ apiKey });
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName }
          }
        }
      }
    });

    const audioPart = response.candidates?.[0]?.content?.parts?.[0];
    if (audioPart && audioPart.inlineData) {
      return audioPart.inlineData.data;
    }
    return null;

  } catch (error: any) {
    // Check for Rate Limit (429) or Quota issues to log friendlier messages
    if (error.status === 429 || error.code === 429 || error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED')) {
        console.warn("TTS Quota Exceeded: Voice skipped for this turn to save quota.");
        return null; 
    }
    
    console.error("TTS generation failed:", error);
    return null;
  }
};

export const validateUsername = async (apiKey: string, username: string): Promise<boolean> => {
    if (!apiKey || !username) return true; // Default to true if api key missing to not block user, or handle elsewhere
    const ai = new GoogleGenAI({ apiKey });

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `
                Evaluate if the username "${username}" is appropriate for a general audience trivia game.
                It should NOT contain profanity, hate speech, sexual content, or offensive slurs.
                
                Respond with valid JSON only:
                { "isSafe": boolean }
            `,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        isSafe: { type: Type.BOOLEAN }
                    }
                }
            }
        });
        
        const text = response.text;
        if (!text) return true;
        const result = JSON.parse(text);
        return result.isSafe;
    } catch (e) {
        console.error("Username validation failed", e);
        return true; // Fail open if API errors
    }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality, Type, ThinkingLevel } from "@google/genai";
import { Language, KisanDostResponse, SYSTEM_INSTRUCTION, ChatMessage } from "../types";

const API_KEY = process.env.API_KEY || process.env.GEMINI_API_KEY;

/**
 * Sanitizes and expands short farmer queries using a keyword dictionary.
 */
const processFarmerQuery = (input: string): string => {
  const query = input.toLowerCase().trim();
  const words = query.split(/\s+/);
  
  // Keyword Dictionary & Mappings
  const mappings: Record<string, string> = {
    "urea": "Provide a general guide, dosage, and safety tips for Urea fertilizer.",
    "dap": "Provide a general guide, dosage, and safety tips for DAP fertilizer.",
    "wheat": "Provide a complete guide for Wheat cultivation, including sowing dates and common pests.",
    "rice": "Provide a complete guide for Rice cultivation, including nursery management and irrigation.",
    "rain": "Provide a weather forecast and irrigation advice based on current rain patterns.",
    "khat": "Provide information about fertilizers (Khaad), including Urea and DAP usage.",
    "khaad": "Provide information about fertilizers (Khaad), including Urea and DAP usage.",
    "keeda": "Provide a diagnosis and control measures for pest (Keeda) attacks in crops.",
    "bemari": "Provide a diagnosis and control measures for crop diseases (Bemari).",
    "paani": "Provide advice on irrigation (Paani) management and water conservation.",
    "bhaav": "Provide current Mandi market prices (Bhaav) for major crops in my region.",
    "sarkari": "Provide information about Government (Sarkari) schemes and subsidies for farmers."
  };

  // If the query is just a single word from our list, 
  // we expand it to help the AI understand.
  if (words.length === 1 && mappings[words[0]]) {
    return mappings[words[0]];
  }
  
  return input;
};

export async function getAgriculturalAdvice(
  query: string, 
  language: Language, 
  history: ChatMessage[] = [],
  image?: { data: string; mimeType: string }
): Promise<KisanDostResponse> {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
  
  const ai = new GoogleGenAI({ apiKey });
  
  const processedQuery = processFarmerQuery(query);
  
  // Quota Optimization: Limit history to last 4 messages to reduce token usage
  const optimizedHistory = history.slice(-4);
  const contents: any[] = [...optimizedHistory];
  
  const currentMessageParts: any[] = [{ text: `Language: ${language}\nQuery: ${processedQuery}` }];

  if (image) {
    currentMessageParts.push({
      inlineData: {
        data: image.data,
        mimeType: image.mimeType
      }
    });
  }

  contents.push({ role: 'user', parts: currentMessageParts });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      maxOutputTokens: 4000, // Reduced from 12000 to save quota
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          greeting: { type: Type.STRING },
          answer: { type: Type.STRING },
          proTips: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          audioSummary: { type: Type.STRING },
          safetySection: { type: Type.STRING, description: "Mandatory safety section if chemicals are mentioned, otherwise null" },
          mandiPrices: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                crop: { type: Type.STRING },
                market: { type: Type.STRING },
                price: { type: Type.STRING },
                trend: { type: Type.STRING, enum: ["up", "down", "stable"] }
              }
            }
          },
          schemes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                benefit: { type: Type.STRING },
                link: { type: Type.STRING }
              }
            }
          }
        },
        required: ["greeting", "answer", "proTips", "audioSummary"]
      }
    }
  });

  let text = (response.text || "").trim();
  
  // Clean up potential markdown wrapping if the model ignores responseMimeType
  if (text.includes("```")) {
    text = text.replace(/```json\n?|```/g, "").trim();
  }

  if (!text) {
    throw new Error("I received an empty response from the AI. This can happen if the query is too complex or sensitive. Please try asking in a different way.");
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error("Initial JSON Parse Error. Raw text length:", text.length);
    
    // Attempt to fix truncated JSON
    try {
      let repairedText = text.trim();
      
      // 1. Handle unclosed strings
      let inString = false;
      let isEscaped = false;
      for (let i = 0; i < repairedText.length; i++) {
        if (repairedText[i] === '"' && !isEscaped) {
          inString = !inString;
        }
        isEscaped = repairedText[i] === '\\' && !isEscaped;
      }
      if (inString) repairedText += '"';

      // 2. Remove trailing commas or colons
      repairedText = repairedText.replace(/[,:]\s*$/, "");

      // 3. Close open braces and brackets using a stack
      const stack: string[] = [];
      let i = 0;
      while (i < repairedText.length) {
        const char = repairedText[i];
        if (char === '"' && (i === 0 || repairedText[i-1] !== '\\')) {
          // Skip string content
          i++;
          while (i < repairedText.length && (repairedText[i] !== '"' || repairedText[i-1] === '\\')) i++;
        } else if (char === '{' || char === '[') {
          stack.push(char === '{' ? '}' : ']');
        } else if (char === '}' || char === ']') {
          if (stack.length > 0 && stack[stack.length - 1] === char) {
            stack.pop();
          }
        }
        i++;
      }
      
      while (stack.length > 0) {
        repairedText += stack.pop();
      }
      
      return JSON.parse(repairedText);
    } catch (repairError) {
      console.error("JSON Repair failed:", repairError);
    }
    
    throw new Error("The response was too long or formatted incorrectly. Please try asking a more specific question.");
  }
}

export async function generateAudio(text: string, language: string = "Odia"): Promise<string | null> {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
  
  const ai = new GoogleGenAI({ apiKey });
  try {
    // The gemini-2.5-flash-preview-tts model is the recommended model for TTS.
    // We pass the text directly without any English prefix so it doesn't get confused.
    // We also clean up any markdown characters that might cause issues.
    const cleanText = text.replace(/[*#_`~]/g, '').trim();

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ 
        parts: [{ 
          text: cleanText 
        }] 
      }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' }, // Warm, helpful voice
          },
        },
      },
    });

    // Find the audio part in the response
    const audioPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    const base64Audio = audioPart?.inlineData?.data || response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!base64Audio) {
      console.error(`Gemini Audio: No audio data in response`, response);
      return null;
    }

    return createWavUrl(base64Audio);
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const isQuotaError = errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED');
    if (!isQuotaError) {
      console.error("Gemini Audio Error:", error);
    }
    throw error;
  }
}

function createWavUrl(base64Audio: string): string {
  // Gemini Audio returns raw PCM (L16) at 24kHz. 
  // We need to wrap it in a WAV header for the <audio> element to play it.
  const pcmData = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  // RIFF identifier
  view.setUint32(0, 0x52494646, false); // "RIFF"
  // file length
  view.setUint32(4, 36 + pcmData.length, true);
  // RIFF type
  view.setUint32(8, 0x57415645, false); // "WAVE"
  // format chunk identifier
  view.setUint32(12, 0x666d7420, false); // "fmt "
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (PCM = 1)
  view.setUint16(20, 1, true);
  // channel count (Mono = 1)
  view.setUint16(22, 1, true);
  // sample rate (24000)
  view.setUint32(24, 24000, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, 24000 * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample (16)
  view.setUint16(34, 16, true);
  // data chunk identifier
  view.setUint32(36, 0x64617461, false); // "data"
  // data chunk length
  view.setUint32(40, pcmData.length, true);

  const wavBlob = new Blob([wavHeader, pcmData], { type: 'audio/wav' });
  return URL.createObjectURL(wavBlob);
}

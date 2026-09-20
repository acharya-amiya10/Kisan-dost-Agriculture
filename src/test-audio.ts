import { GoogleGenAI, Modality } from "@google/genai";

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
      contents: "Please say 'Hello, how are you?' in Hindi.",
      config: {
        responseModalities: [Modality.AUDIO],
      }
    });
    const audioPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    console.log("Native Audio success:", !!audioPart);
  } catch (e) {
    console.error("Native Audio error:", e);
  }

  try {
    const response2 = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: "नमस्ते, आप कैसे हैं?",
      config: {
        responseModalities: [Modality.AUDIO],
      }
    });
    const audioPart2 = response2.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    console.log("TTS success:", !!audioPart2);
  } catch (e) {
    console.error("TTS error:", e);
  }
}

test();

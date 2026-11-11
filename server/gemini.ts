import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { ProjectRecapScript, OcrDetection, SpeechSegment, DialogueTranslationSegment } from './types';

// Shared Gemini instance with required aistudio-build User-Agent
export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server environment.');
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Recognize Chinese subtitles and visible on-screen text from extracted video frames
 */
export async function extractOcrFromFrames(
  framesDir: string,
  intervalSeconds: number
): Promise<OcrDetection[]> {
  const ai = getGeminiClient();
  const detections: OcrDetection[] = [];

  if (!fs.existsSync(framesDir)) {
    return detections;
  }

  const files = fs
    .readdirSync(framesDir)
    .filter((f) => f.endsWith('.jpg') || f.endsWith('.png'))
    .sort();

  if (files.length === 0) {
    return detections;
  }

  // Group frames in batches of up to 4 for efficient Gemini vision processing
  const batchSize = 4;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const parts: any[] = [];

    const frameTimestamps: number[] = [];
    for (const file of batch) {
      const match = file.match(/frame_(\d+)/);
      const frameIndex = match ? parseInt(match[1], 10) : i + 1;
      const timestamp = Math.max(0, (frameIndex - 1) * intervalSeconds);
      frameTimestamps.push(timestamp);

      const filePath = path.join(framesDir, file);
      const data = fs.readFileSync(filePath).toString('base64');
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data,
        },
      });
    }

    parts.push({
      text: `You are an expert at reading Chinese video subtitles and on-screen text.
For each attached frame in order (Frames: ${frameTimestamps.map((t) => t + 's').join(', ')}):
1. Detect any hardcoded Chinese subtitles (dialogue or narration).
2. Detect visible on-screen Chinese text (scene location, character names, dates, signs).
3. Ignore unrelated background noise if it is illegible.
4. If no clear Chinese text or subtitles appear, leave chineseText empty.

Return a JSON array with one object per detected text segment:
[{ "frameIndex": number, "chineseText": string }]`,
    });

    try {
    const ocrModels = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
    let ocrSuccess = false;

    for (const modelName of ocrModels) {
      try {
        const generatePromise = ai.models.generateContent({
          model: modelName,
          contents: parts,
          config: {
            responseMimeType: 'application/json',
          },
        });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('OCR Timeout after 12s')), 12000)
        );

        const response: any = await Promise.race([generatePromise, timeoutPromise]);
        const rawText = (response?.text ?? '[]').trim();
        const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJson);

        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const text = (item.chineseText || item.text || '').trim();
            if (text) {
              const frameIdx = Math.max(1, Math.min(batch.length, item.frameIndex || 1));
              const ts = frameTimestamps[frameIdx - 1] ?? 0;
              detections.push({
                timestamp: ts,
                chineseText: text,
              });
            }
          }
        }
        ocrSuccess = true;
        break;
      } catch (err: any) {
        // try next model
      }
    }

    } catch (err: any) {
      // batch error fallback
    }
  }

  return detections;
}

/**
 * Generate a comprehensive Burmese Movie Recap script from Chinese dialogue and OCR text
 */
export async function generateBurmeseRecapScript(params: {
  chineseTimelineContext: string;
  recapLength: 'short' | 'medium' | 'long';
  videoDuration: number;
  sourceLanguage?: string;
}): Promise<ProjectRecapScript> {
  const ai = getGeminiClient();

  const lengthInstructions = {
    short: 'Short recap (တိုတိုတုတ်တုတ်): 4 to 6 narration segments focusing on core premise and quick resolution (~1-2 minutes).',
    medium: 'Medium recap (အလယ်အလတ်): 8 to 12 narration segments with clear plot progression, character actions, and climax (~3-4 minutes).',
    long: 'Long recap (အသေးစိတ် ပြည့်စုံသော): 14 to 20 narration segments detailing character motivations, twists, tension, and resolution (~5-7 minutes).',
  }[params.recapLength];

  const systemInstruction = `You are a master Chinese movie recap creator and storyteller for Burmese audiences.
Your job is to analyze Chinese movie dialogue, subtitles, and scene text, and write a natural, dramatic, and captivating movie recap narration script in standard Myanmar Unicode (မြန်မာယူနီကုဒ်).

IMPORTANT RULES:
1. Write 100% natural, fluent, and grammatical Myanmar Unicode (သဘာဝကျကျ ဆွဲဆောင်မှုရှိသော မြန်မာစကားပြော ဇာတ်ကြောင်းပြန်ပြချက်).
2. Do NOT invent unrelated storylines; faithfully explain what happened in the Chinese source.
3. Keep character names transliterated phonetically into Myanmar script (e.g. လီရှောင်၊ ကျန်းဝေ၊ ချန်းယွမ်).
4. Organize into a cohesive beginning (အစ), middle (အလယ်), climax & resolution (အဆုံး).
5. Output distinct narration segments suitable for voice-over text-to-speech. Each narration segment should be a natural paragraph of 2 to 4 sentences.
6. Target recap format: ${lengthInstructions}`;

  const prompt = `Here is the chronological ${params.sourceLanguage || 'Chinese'} speech transcript and on-screen text from the video (Total video length: ${Math.round(
    params.videoDuration
  )}s):

${params.chineseTimelineContext}

Please generate the complete Burmese Movie Recap Script:
- title: Burmese movie title / recap title
- genre: genre in Burmese (e.g. အက်ရှင် / ဒရမ်မာ / သည်းထိတ်ရင်ဖို / အချစ်)
- charactersSummary: list of key characters with their role and description in Burmese
- synopsis: an overarching story synopsis in Burmese
- narrationSegments: array of chronological recap voice-over paragraphs with id (1, 2, 3...) and text in Myanmar Unicode.`;

  const modelsToTry = [
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
    'gemini-3.8-flash',
  ];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: 'Burmese movie recap title' },
                genre: { type: Type.STRING, description: 'Genre in Burmese' },
                charactersSummary: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: 'Character name in Burmese' },
                      role: { type: Type.STRING, description: 'Role or relation in Burmese' },
                      description: { type: Type.STRING, description: 'Short description in Burmese' },
                    },
                    required: ['name', 'role', 'description'],
                  },
                },
                synopsis: { type: Type.STRING, description: 'Comprehensive synopsis in Burmese' },
                narrationSegments: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.INTEGER, description: 'Segment sequential number' },
                      text: { type: Type.STRING, description: 'Burmese narration script paragraph' },
                    },
                    required: ['id', 'text'],
                  },
                },
              },
              required: ['title', 'genre', 'charactersSummary', 'synopsis', 'narrationSegments'],
            },
          },
        });

        const parsed = JSON.parse(response.text ?? '{}');
        return {
          title: parsed.title || 'တရုတ်ရုပ်ရှင် ဇာတ်ကားရှင်းပြချက်',
          genre: parsed.genre || 'ရုပ်ရှင်ဇာတ်ကား',
          charactersSummary: parsed.charactersSummary || [],
          synopsis: parsed.synopsis || '',
          narrationSegments: parsed.narrationSegments || [],
          approved: false,
        };
      } catch (err: any) {
        lastError = err;
        const isTransient = err.message?.includes('503') || err.message?.includes('429') || err.message?.includes('high demand');
        if (isTransient) {
          await new Promise((r) => setTimeout(r, 600 * attempt));
        }
      }
    }
  }

  throw new Error(`Gemini recap generation failed: ${lastError?.message || 'All configured models failed'}`, {
    cause: lastError,
  });
}

/**
 * Translate original Chinese dialogue sentence by sentence into natural Burmese
 * for Subtitle Mode and Dubbing Mode.
 */
export async function translateChineseDialogueSegments(
  speechSegments: SpeechSegment[],
  ocrDetections: OcrDetection[],
  sourceLanguage = 'zh'
): Promise<DialogueTranslationSegment[]> {
  const ai = getGeminiClient();

  // 1. Build initial dialogue list from speech recognition segments
  const rawList: Array<{ id: number; start: number; end: number; chineseText: string }> = [];

  if (speechSegments && speechSegments.length > 0) {
    speechSegments.forEach((seg, idx) => {
      const text = (seg.text || '').trim();
      if (text) {
        rawList.push({
          id: idx + 1,
          start: typeof seg.start === 'number' ? seg.start : 0,
          end: typeof seg.end === 'number' ? seg.end : (seg.start || 0) + 3,
          chineseText: text,
        });
      }
    });
  }

  // If speech segments are empty, use OCR detections
  if (rawList.length === 0 && ocrDetections && ocrDetections.length > 0) {
    ocrDetections.forEach((det, idx) => {
      const text = (det.chineseText || '').trim();
      if (text && !text.includes('全剧终') && !text.includes('序幕')) {
        const start = det.timestamp;
        const end = start + 3.0;
        rawList.push({
          id: idx + 1,
          start,
          end,
          chineseText: text,
        });
      }
    });
  }

  if (rawList.length === 0) {
    throw new Error('No speech or readable on-screen text was found to translate.');
  }

  const sourceLanguageNames: Record<string, string> = {
    zh: 'Chinese', en: 'English', ja: 'Japanese', ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German', auto: 'source-language',
  };
  const sourceLanguageName = sourceLanguageNames[sourceLanguage] || 'source-language';
  const prompt = `You are an expert translator specializing in translating ${sourceLanguageName} movie dialogue into natural, fluent Burmese (မြန်မာယူနီကုဒ်).
Translate the following ${sourceLanguageName} dialogue segments sentence-by-sentence into natural Burmese:
IMPORTANT RULES:
1. Translate accurately sentence by sentence.
2. DO NOT write a story recap.
3. Preserve the exact dialogue order and meaning.
4. Keep the output in standard Myanmar Unicode (မြန်မာယူနီကုဒ်).

Input ${sourceLanguageName} dialogue segments:
${JSON.stringify(rawList, null, 2)}

Return a JSON array of objects:
[{ "id": number, "start": number, "end": number, "chineseText": string, "burmeseText": string }]`;

  const modelsToTry = [
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
    'gemini-3.8-flash',
  ];

  let lastError: unknown;
  for (const model of modelsToTry) {
    try {
      const resp = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER },
                start: { type: Type.NUMBER },
                end: { type: Type.NUMBER },
                chineseText: { type: Type.STRING },
                burmeseText: { type: Type.STRING },
              },
              required: ['id', 'start', 'end', 'chineseText', 'burmeseText'],
            },
          },
        },
      });

      const parsed = JSON.parse(resp.text ?? '[]');
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item, idx) => ({
          id: idx + 1,
          start: typeof item.start === 'number' ? item.start : rawList[idx]?.start ?? idx * 3,
          end: typeof item.end === 'number' ? item.end : rawList[idx]?.end ?? (idx + 1) * 3,
          chineseText: item.chineseText || rawList[idx]?.chineseText || '',
          burmeseText: (item.burmeseText || '').trim(),
        }));
      }
    } catch (err) {
      lastError = err;
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'All configured models failed';
  throw new Error(`Gemini dialogue translation failed: ${message}`, { cause: lastError });
}

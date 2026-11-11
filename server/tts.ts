import fs from 'fs';
import path from 'path';
import https from 'https';
import { NarrationSegment, DialogueTranslationSegment } from './types';
import { SubtitleCue, generateSrtContent, breakBurmeseLines } from '../src/utils/subtitle';
import { getVideoMetadata, runFFmpeg } from './ffmpeg';
import { createRequire } from 'module';
import { buildAtempoFilter, parseSpeedMultiplier } from '../src/utils/speed';

const require = createRequire(import.meta.url);
const { EdgeTTS } = require('node-edge-tts');
export { EdgeTTS };

export interface TtsVoiceOption {
  id: string;
  name: string;
  gender: 'female' | 'male';
  sampleText: string;
}

export const BURMESE_VOICES: TtsVoiceOption[] = [
  {
    id: 'my-MM-NilarNeural',
    name: 'နီလာ (မိန်းကလေးအသံ - Nilar Neural)',
    gender: 'female',
    sampleText: 'မင်္ဂလာပါ၊ My AI Studio မှ ကြိုဆိုပါတယ်။ တရုတ်ရုပ်ရှင်ဇာတ်ကား ရှင်းပြချက်ကို စတင်နားဆင်ပါတော့မယ်။',
  },
  {
    id: 'my-MM-ThihaNeural',
    name: 'သီဟ (ယောက်ျားလေးအသံ - Thiha Neural)',
    gender: 'male',
    sampleText: 'မင်္ဂလာပါ၊ My AI Studio မှ ကြိုဆိုပါတယ်။ တရုတ်ရုပ်ရှင်ဇာတ်ကား ရှင်းပြချက်ကို စတင်နားဆင်ပါတော့မယ်။',
  },
];

/**
 * Split long Burmese text into manageable segments for TTS fallback
 */
function splitBurmeseTextForGoogle(text: string, maxLen = 120): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let sliceIdx = remaining.lastIndexOf('။', maxLen);
    if (sliceIdx === -1 || sliceIdx < 40) sliceIdx = remaining.lastIndexOf('၊', maxLen);
    if (sliceIdx === -1 || sliceIdx < 40) sliceIdx = remaining.lastIndexOf(' ', maxLen);
    if (sliceIdx === -1 || sliceIdx < 40) sliceIdx = maxLen;
    else sliceIdx = sliceIdx + 1;
    chunks.push(remaining.substring(0, sliceIdx).trim());
    remaining = remaining.substring(sliceIdx).trim();
  }
  return chunks.filter((c) => c.length > 0);
}

/**
 * Download a single Burmese speech audio chunk from Google Voice TTS
 */
function downloadGoogleTtsChunk(text: string): Promise<Buffer> {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
    text
  )}&tl=my&client=tw-ob`;
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 9000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Google TTS status: ${res.statusCode}`));
        }
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Google TTS request timeout'));
    });
    req.on('error', reject);
  });
}

/**
 * Synthesize Burmese audio using Google Myanmar Voice Engine
 */
export async function synthesizeBurmeseWithGoogle(
  text: string,
  outputPath: string
): Promise<boolean> {
  try {
    const chunks = splitBurmeseTextForGoogle(text);
    if (chunks.length === 0) return false;
    const buffers: Buffer[] = [];
    for (const chunk of chunks) {
      const buf = await downloadGoogleTtsChunk(chunk);
      if (buf && buf.length > 100) {
        buffers.push(buf);
      }
    }
    if (buffers.length === 0) return false;
    fs.writeFileSync(outputPath, Buffer.concat(buffers));
    const stats = fs.statSync(outputPath);
    return stats.size > 500;
  } catch {
    return false;
  }
}

/**
 * Synthesize a single Burmese speech audio segment with multi-engine resilience:
 * 1. EdgeTTS Neural Voice (Nilar/Thiha)
 * 2. Instant Google Myanmar Voice Fallback on 429 rate limit or network issue
 * 3. FFmpeg atempo speed adjustment (0.75x to 3.00x)
 * 4. Explicit failure if neither real speech provider succeeds
 */
export async function synthesizeBurmeseTts(params: {
  text: string;
  outputPath: string;
  voiceId?: string;
  rate?: string;
  segmentIndex?: number;
  skipEdgeTts?: boolean;
}): Promise<{ outputPath: string; duration: number; isFallback?: boolean }> {
  const {
    text,
    outputPath,
    voiceId = 'my-MM-NilarNeural',
    rate = '1.00x',
    segmentIndex = 1,
    skipEdgeTts = false,
  } = params;

  const speedMultiplier = parseSpeedMultiplier(rate);
  const needsAtempo = Math.abs(speedMultiplier - 1.0) >= 0.01;

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 1. If valid audio already exists on disk from a previous run or retry, reuse it
  if (fs.existsSync(outputPath)) {
    try {
      const stats = fs.statSync(outputPath);
      if (stats.size > 800) {
        const meta = await getVideoMetadata(outputPath);
        if (meta.duration > 0.2) {
          return { outputPath, duration: meta.duration };
        }
      }
      fs.unlinkSync(outputPath);
    } catch {
      try { fs.unlinkSync(outputPath); } catch {}
    }
  }

  const cleanText = text.trim();
  if (!cleanText) {
    const silenceDuration = Math.max(0.2, 0.5 / speedMultiplier);
    await runFFmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'anullsrc=r=24000:cl=mono',
      '-t', String(silenceDuration),
      '-acodec', 'libmp3lame',
      '-b:a', '64k',
      outputPath,
    ]);
    return { outputPath, duration: silenceDuration };
  }

  // -------------------------------------------------------------------------
  // ENGINE 1: EdgeTTS Neural
  // -------------------------------------------------------------------------
  if (!skipEdgeTts) {
    const candidateVoices = [
      voiceId,
      voiceId === 'my-MM-NilarNeural' ? 'my-MM-ThihaNeural' : 'my-MM-NilarNeural',
    ];

    const MAX_EDGE_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_EDGE_ATTEMPTS; attempt++) {
      const currentVoice = attempt === 2 ? candidateVoices[1] : candidateVoices[0];
      const rawOutputPath = needsAtempo ? `${outputPath}.raw_${Date.now()}.mp3` : outputPath;

      try {
        const tts = new EdgeTTS({
          voice: currentVoice,
          lang: 'my-MM',
          rate: '+0%',
        });

        await tts.ttsPromise(cleanText, rawOutputPath);

        if (fs.existsSync(rawOutputPath)) {
          const stats = fs.statSync(rawOutputPath);
          if (stats.size > 800) {
            if (needsAtempo) {
              const atempoFilter = buildAtempoFilter(speedMultiplier);
              await runFFmpeg([
                '-y',
                '-i', rawOutputPath,
                '-filter:a', atempoFilter,
                '-acodec', 'libmp3lame',
                '-b:a', '192k',
                outputPath,
              ]);
              try { fs.unlinkSync(rawOutputPath); } catch {}
            }

            if (fs.existsSync(outputPath)) {
              const outStats = fs.statSync(outputPath);
              if (outStats.size > 500) {
                const meta = await getVideoMetadata(outputPath);
                const duration = meta.duration > 0 ? meta.duration : (3.5 / speedMultiplier);
                return { outputPath, duration };
              }
            }
          }
        }
      } catch (err: any) {
        // Clean up failed files quietly
        if (needsAtempo && fs.existsSync(rawOutputPath)) {
          try { fs.unlinkSync(rawOutputPath); } catch {}
        }
        if (fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch {}
        }

        // If rate limit (429) hit, immediately break and switch to Google Voice engine
        if (err.message?.includes('429')) {
          break;
        }

        if (attempt < MAX_EDGE_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // ENGINE 2: Google Myanmar Voice Engine Fallback
  // -------------------------------------------------------------------------
  try {
    const rawGooglePath = needsAtempo ? `${outputPath}.graw_${Date.now()}.mp3` : outputPath;
    const googleSuccess = await synthesizeBurmeseWithGoogle(cleanText, rawGooglePath);

    if (googleSuccess && fs.existsSync(rawGooglePath)) {
      if (needsAtempo) {
        const atempoFilter = buildAtempoFilter(speedMultiplier);
        await runFFmpeg([
          '-y',
          '-i', rawGooglePath,
          '-filter:a', atempoFilter,
          '-acodec', 'libmp3lame',
          '-b:a', '192k',
          outputPath,
        ]);
        try { fs.unlinkSync(rawGooglePath); } catch {}
      }

      if (fs.existsSync(outputPath)) {
        const meta = await getVideoMetadata(outputPath);
        if (meta.duration > 0.2) {
          return { outputPath, duration: meta.duration, isFallback: true };
        }
      }
    }
  } catch {
    // Continue to safety duration synthesis
  }

  throw new Error(`Speech synthesis failed for segment ${segmentIndex}: Edge TTS and Google TTS both failed.`);
}

/**
 * Generate a quick voice sample for preview with speed adjustment
 */
export async function generateVoicePreview(
  voiceId: string,
  rate = '1.00x',
  outputPath: string,
  sampleText?: string
): Promise<string> {
  const voice = BURMESE_VOICES.find((v) => v.id === voiceId) || BURMESE_VOICES[0];
  await synthesizeBurmeseTts({
    text: sampleText || voice.sampleText,
    outputPath,
    voiceId: voice.id,
    rate,
    segmentIndex: 1,
  });
  return outputPath;
}

/**
 * Generate complete Burmese narration audio from script segments,
 * concatenate audio, and produce synchronized Burmese SRT subtitles.
 */
export async function generateBurmeseNarration(params: {
  segments: NarrationSegment[];
  voiceId: string;
  rate?: string;
  outputDir: string;
}): Promise<{
  audioPath: string;
  srtPath: string;
  totalDuration: number;
  cues: SubtitleCue[];
}> {
  const { segments, voiceId, rate = '1.00x', outputDir } = params;
  const speedMultiplier = parseSpeedMultiplier(rate);
  const speedSuffix = Math.round(speedMultiplier * 100);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const segmentAudioDir = path.join(outputDir, 'narration_segments');
  if (!fs.existsSync(segmentAudioDir)) {
    fs.mkdirSync(segmentAudioDir, { recursive: true });
  }

  const generatedAudioFiles: string[] = [];
  const subtitleCues: SubtitleCue[] = [];
  let currentTime = 0.5; // Start with a brief 0.5s pause
  let skipEdgeForBatch = false;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segAudioFile = path.join(segmentAudioDir, `seg_${String(i + 1).padStart(3, '0')}_${speedSuffix}.mp3`);

    const cleanText = seg.text.trim();
    if (!cleanText) continue;

    // Pacing delay between segments
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, skipEdgeForBatch ? 400 : 1200));
    }

    const { duration: segmentDuration, isFallback } = await synthesizeBurmeseTts({
      text: cleanText,
      outputPath: segAudioFile,
      voiceId,
      rate,
      segmentIndex: i + 1,
      skipEdgeTts: skipEdgeForBatch,
    });

    if (isFallback) {
      skipEdgeForBatch = true;
    }

    generatedAudioFiles.push(segAudioFile);

    const startTime = currentTime;
    const endTime = currentTime + segmentDuration;

    // Break long sentences for clear subtitles
    const brokenText = breakBurmeseLines(cleanText, 45);

    subtitleCues.push({
      id: subtitleCues.length + 1,
      startTime,
      endTime,
      text: brokenText,
    });

    // Natural pause between narrative paragraphs scaled proportionally to speech speed
    const pauseDuration = Math.max(0.12, Math.min(0.35, 0.35 / speedMultiplier));
    currentTime = endTime + pauseDuration;
  }

  // Concatenate all audio segments into a single narration.mp3 using FFmpeg concat
  const finalAudioPath = path.join(outputDir, 'narration.mp3');
  const concatListPath = path.join(segmentAudioDir, 'concat_list.txt');

  const fileEntries = generatedAudioFiles
    .map((f) => `file '${path.resolve(f).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(concatListPath, fileEntries, 'utf8');

  await runFFmpeg([
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatListPath,
    '-acodec', 'libmp3lame',
    '-b:a', '192k',
    finalAudioPath,
  ]);

  // Generate SRT Subtitle file
  const srtContent = generateSrtContent(subtitleCues);
  const srtPath = path.join(outputDir, 'subtitles.srt');
  fs.writeFileSync(srtPath, srtContent, 'utf8');

  return {
    audioPath: finalAudioPath,
    srtPath,
    totalDuration: currentTime,
    cues: subtitleCues,
  };
}

/**
 * Generate sentence-by-sentence Burmese Dubbing Audio using ONE selected Burmese AI voice.
 * Synchronizes speech with original dialogue timestamps without creating a recap script.
 */
export async function generateBurmeseDubbingAudio(params: {
  segments: DialogueTranslationSegment[];
  voiceId: string;
  rate?: string;
  videoDuration: number;
  outputDir: string;
}): Promise<{
  audioPath: string;
  srtPath: string;
  totalDuration: number;
  cues: SubtitleCue[];
}> {
  const { segments, voiceId, rate = '1.00x', videoDuration, outputDir } = params;
  const speedMultiplier = parseSpeedMultiplier(rate);
  const speedSuffix = Math.round(speedMultiplier * 100);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const dubbingAudioDir = path.join(outputDir, 'dubbing_segments');
  if (!fs.existsSync(dubbingAudioDir)) {
    fs.mkdirSync(dubbingAudioDir, { recursive: true });
  }

  // Sort segments chronologically
  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);

  const audioPartsList: string[] = [];
  const subtitleCues: SubtitleCue[] = [];
  let cursorTime = 0.0;
  let skipEdgeForBatch = false;

  for (let i = 0; i < sortedSegments.length; i++) {
    const seg = sortedSegments[i];
    const cleanText = (seg.burmeseText || '').trim();
    if (!cleanText) continue;

    const segAudioFile = path.join(dubbingAudioDir, `dub_${String(i + 1).padStart(3, '0')}_${speedSuffix}.mp3`);

    // Synthesize using the ONE selected voice
    const { duration: segDuration, isFallback } = await synthesizeBurmeseTts({
      text: cleanText,
      outputPath: segAudioFile,
      voiceId,
      rate,
      segmentIndex: i + 1,
      skipEdgeTts: skipEdgeForBatch,
    });

    if (isFallback) {
      skipEdgeForBatch = true;
    }

    const targetStart = Math.max(cursorTime, seg.start);

    // If there is silence between current time and dialogue start, generate silence chunk
    if (targetStart > cursorTime + 0.05) {
      const silenceDuration = Math.round((targetStart - cursorTime) * 100) / 100;
      const silenceFile = path.join(dubbingAudioDir, `sil_${String(i + 1).padStart(3, '0')}.mp3`);
      await runFFmpeg([
        '-y',
        '-f', 'lavfi',
        '-i', 'anullsrc=r=24000:cl=mono',
        '-t', String(silenceDuration),
        '-acodec', 'libmp3lame',
        '-b:a', '128k',
        silenceFile,
      ]);
      audioPartsList.push(silenceFile);
      cursorTime += silenceDuration;
    }

    audioPartsList.push(segAudioFile);
    const speechStartTime = cursorTime;
    const speechEndTime = cursorTime + segDuration;
    cursorTime = speechEndTime;

    // Subtitle cue for this dubbed line
    const brokenText = breakBurmeseLines(cleanText, 45);
    subtitleCues.push({
      id: subtitleCues.length + 1,
      startTime: speechStartTime,
      endTime: speechEndTime,
      text: brokenText,
    });

    if (i < sortedSegments.length - 1) {
      await new Promise((r) => setTimeout(r, skipEdgeForBatch ? 200 : 800));
    }
  }

  // Trailing silence to match full video length if needed
  if (videoDuration > cursorTime + 0.1) {
    const trailingSilenceDuration = Math.round((videoDuration - cursorTime) * 100) / 100;
    const trailingSilenceFile = path.join(dubbingAudioDir, 'sil_trailing.mp3');
    await runFFmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'anullsrc=r=24000:cl=mono',
      '-t', String(trailingSilenceDuration),
      '-acodec', 'libmp3lame',
      '-b:a', '128k',
      trailingSilenceFile,
    ]);
    audioPartsList.push(trailingSilenceFile);
    cursorTime += trailingSilenceDuration;
  }

  // Concatenate all parts into dubbing.mp3
  const finalAudioPath = path.join(outputDir, 'dubbing.mp3');
  const concatListPath = path.join(dubbingAudioDir, 'concat_list.txt');

  const fileEntries = audioPartsList
    .map((f) => `file '${path.resolve(f).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(concatListPath, fileEntries, 'utf8');

  await runFFmpeg([
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatListPath,
    '-acodec', 'libmp3lame',
    '-b:a', '192k',
    finalAudioPath,
  ]);

  // Generate SRT Subtitle file
  const srtContent = generateSrtContent(subtitleCues);
  const srtPath = path.join(outputDir, 'subtitles.srt');
  fs.writeFileSync(srtPath, srtContent, 'utf8');

  return {
    audioPath: finalAudioPath,
    srtPath,
    totalDuration: cursorTime,
    cues: subtitleCues,
  };
}

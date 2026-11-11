import { execFile, spawn } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = util.promisify(execFile);
const MAX_FFPROBE_BUFFER = 10 * 1024 * 1024;

/** Run FFmpeg without buffering its potentially large output streams. */
export function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-nostats', ...args],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const maxErrorLength = 16 * 1024;
    let stderrTail = '';

    process.stdout?.on('data', () => {});
    process.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-maxErrorLength);
    });
    process.on('error', (err) => reject(new Error(`Failed to start FFmpeg: ${err.message}`, { cause: err })));
    process.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const status = signal ? `signal ${signal}` : `code ${code}`;
      reject(new Error(`FFmpeg exited with ${status}${stderrTail.trim() ? `: ${stderrTail.trim()}` : ''}`));
    });
  });
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  format: string;
  hasAudio: boolean;
}

/**
 * Probe video metadata using ffprobe
 */
export async function getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=width,height,duration,codec_type:format=duration,format_name',
      '-of',
      'json',
      videoPath,
    ], { maxBuffer: MAX_FFPROBE_BUFFER });

    const data = JSON.parse(stdout);
    const videoStream = data.streams?.find((s: any) => s.codec_type === 'video') || {};
    const hasAudio = Boolean(data.streams?.some((s: any) => s.codec_type === 'audio'));
    const format = data.format || {};

    const duration = parseFloat(videoStream.duration || format.duration || '0');
    const width = parseInt(videoStream.width || '1280', 10);
    const height = parseInt(videoStream.height || '720', 10);

    return {
      duration: isNaN(duration) ? 0 : duration,
      width,
      height,
      format: format.format_name || 'mp4',
      hasAudio,
    };
  } catch (err: any) {
    throw new Error(`ffprobe failed for ${videoPath}: ${err.message}`, { cause: err });
  }
}

/**
 * Extract audio from video file to 16kHz mono MP3 for speech recognition
 */
export async function extractAudio(videoPath: string, audioOutputPath: string): Promise<void> {
  const dir = path.dirname(audioOutputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await runFFmpeg([
    '-y',
    '-i',
    videoPath,
    '-vn',
    '-acodec',
    'libmp3lame',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-b:a',
    '64k',
    audioOutputPath,
  ]);
}

/**
 * Extract representative keyframes from video for OCR
 */
export async function extractFrames(
  videoPath: string,
  outputDir: string,
  intervalSeconds: number = 5,
  maxFrames: number = 24
): Promise<string[]> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Clear any existing frames
  const existing = fs.readdirSync(outputDir);
  for (const f of existing) {
    fs.unlinkSync(path.join(outputDir, f));
  }

  // Compute fps filter: 1 frame every intervalSeconds
  const fpsValue = `fps=1/${Math.max(1, intervalSeconds)}`;

  await runFFmpeg([
    '-y',
    '-i',
    videoPath,
    '-vf',
    `${fpsValue},scale=640:-1`,
    '-frames:v',
    String(maxFrames),
    path.join(outputDir, 'frame_%04d.jpg'),
  ]);

  return fs
    .readdirSync(outputDir)
    .filter((f) => f.endsWith('.jpg') || f.endsWith('.png'))
    .sort()
    .map((f) => path.join(outputDir, f));
}

/**
 * Split large audio files into smaller overlapping chunks for API limits
 */
export async function splitAudioFile(
  audioPath: string,
  outputDir: string,
  chunkDurationSec: number = 600,
  overlapSec: number = 2
): Promise<Array<{ filePath: string; startTime: number; duration: number }>> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const { duration } = await getVideoMetadata(audioPath);
  const totalDuration = duration > 0 ? duration : 1800;
  const chunks: Array<{ filePath: string; startTime: number; duration: number }> = [];

  let currentStart = 0;
  let chunkIndex = 0;

  while (currentStart < totalDuration) {
    chunkIndex++;
    const actualDuration = Math.min(chunkDurationSec, totalDuration - currentStart);
    const chunkPath = path.join(outputDir, `chunk_${String(chunkIndex).padStart(3, '0')}.mp3`);

    await runFFmpeg([
      '-y',
      '-ss',
      String(currentStart),
      '-i',
      audioPath,
      '-t',
      String(actualDuration),
      '-acodec',
      'copy',
      chunkPath,
    ]);

    chunks.push({
      filePath: chunkPath,
      startTime: currentStart,
      duration: actualDuration,
    });

    currentStart += chunkDurationSec - overlapSec;
  }

  return chunks;
}

/**
 * Combine video, Burmese narration audio, and Burmese subtitles with Noto Sans Myanmar font
 */
export async function renderFinalRecap(params: {
  videoPath: string;
  narrationAudioPath: string;
  srtPath?: string;
  outputPath: string;
  originalAudioVolume?: number; // 0 to 1
  burnSubtitles?: boolean;
}): Promise<void> {
  const {
    videoPath,
    narrationAudioPath,
    srtPath,
    outputPath,
    originalAudioVolume = 0.15,
    burnSubtitles = true,
  } = params;

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const hasSubtitles = burnSubtitles && srtPath && fs.existsSync(srtPath);
  const hasNarration = fs.existsSync(narrationAudioPath);

  const ffmpegArgs: string[] = ['-y', '-i', videoPath];

  if (hasNarration) {
    ffmpegArgs.push('-i', narrationAudioPath);
  }

  // Filter complex for audio and video
  let filterComplex = '';
  let mapVideo = '0:v';
  let mapAudio = '0:a';

  const meta = await getVideoMetadata(videoPath);
  const videoWidth = meta.width > 0 ? meta.width : 1080;
  const videoHeight = meta.height > 0 ? meta.height : 1920;

  if (hasSubtitles) {
    // Generate matching .ass file with lower-center positioning (23% from bottom for portrait, 10% for landscape)
    const { parseSrtContent, generateAssContent } = await import('../src/utils/subtitle');
    const srtContent = fs.readFileSync(srtPath, 'utf8');
    const cues = parseSrtContent(srtContent);
    const assContent = generateAssContent(cues, videoWidth, videoHeight);
    const assPath = path.join(outDir, 'subtitles.ass');
    fs.writeFileSync(assPath, assContent, 'utf8');

    // Burn subtitles with ASS filter and Noto Sans Myanmar font
    const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    filterComplex += `[0:v]ass='${escapedAss}'[vout];`;
    mapVideo = '[vout]';
  }

  if (hasNarration) {
    if (originalAudioVolume <= 0.01 || !meta.hasAudio) {
      // Original audio muted or source video has no audio track, use narration only
      mapAudio = '1:a';
    } else {
      // Duck original audio and mix with narration
      filterComplex += `[0:a]volume=${originalAudioVolume.toFixed(2)}[orig];[orig][1:a]amix=inputs=2:duration=longest:dropout_transition=2[aout];`;
      mapAudio = '[aout]';
    }
  } else if (!meta.hasAudio) {
    ffmpegArgs.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono');
    mapAudio = '1:a';
  }

  if (filterComplex) {
    ffmpegArgs.push('-filter_complex', filterComplex.replace(/;$/, ''));
  }

  ffmpegArgs.push('-map', mapVideo);
  ffmpegArgs.push('-map', mapAudio);
  ffmpegArgs.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-c:a', 'aac', '-b:a', '192k', '-shortest', outputPath);

  await runFFmpeg(ffmpegArgs);
}

/**
 * Generate a demo sample Chinese video clip for quick testing and onboarding
 */
export async function generateDemoVideo(outputPath: string): Promise<void> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Generate 8-second demo video with title and synthetic Chinese audio tone
  await runFFmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=8:size=1280x720:rate=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=8',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-shortest',
    outputPath,
  ]);
}

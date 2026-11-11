/**
 * Subtitle utility functions for Burmese (Myanmar Unicode) SRT generation,
 * parsing, timing calculations, and line breaking.
 */

export interface SubtitleCue {
  id: number;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  text: string;
}

/**
 * Format seconds into SRT timestamp string: HH:MM:SS,mmm
 */
export function formatSrtTimestamp(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const totalMillis = Math.round(seconds * 1000);
  const hours = Math.floor(totalMillis / 3600000);
  const remainderAfterHours = totalMillis % 3600000;
  const minutes = Math.floor(remainderAfterHours / 60000);
  const remainderAfterMinutes = remainderAfterHours % 60000;
  const secs = Math.floor(remainderAfterMinutes / 1000);
  const millis = remainderAfterMinutes % 1000;

  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
}

/**
 * Parse SRT timestamp HH:MM:SS,mmm or HH:MM:SS.mmm into seconds
 */
export function parseSrtTimestamp(timestamp: string): number {
  const normalized = timestamp.trim().replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  return 0;
}

/**
 * Generate standard SRT file format string from subtitle cues
 */
export function generateSrtContent(cues: SubtitleCue[]): string {
  return cues
    .map((cue, index) => {
      const cueIndex = index + 1;
      const startStr = formatSrtTimestamp(cue.startTime);
      const endStr = formatSrtTimestamp(cue.endTime);
      const cleanText = cue.text.trim();
      return `${cueIndex}\n${startStr} --> ${endStr}\n${cleanText}\n`;
    })
    .join('\n');
}

/** Generate WebVTT content from the same synchronized subtitle cues. */
export function generateVttContent(cues: SubtitleCue[]): string {
  const entries = cues.map((cue, index) => {
    const start = formatSrtTimestamp(cue.startTime).replace(',', '.');
    const end = formatSrtTimestamp(cue.endTime).replace(',', '.');
    return `${index + 1}\n${start} --> ${end}\n${cue.text.trim()}`;
  });
  return `WEBVTT\n\n${entries.join('\n\n')}\n`;
}

/**
 * Parse an SRT string into an array of SubtitleCues
 */
export function parseSrtContent(srtText: string): SubtitleCue[] {
  if (!srtText) return [];
  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.trim().split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length >= 2) {
      let timeLineIdx = 1;
      // Handle cases where the index line might be missing
      if (lines[0].includes('-->')) {
        timeLineIdx = 0;
      }
      const timeMatch = lines[timeLineIdx].match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/);
      if (timeMatch) {
        const startTime = parseSrtTimestamp(timeMatch[1]);
        const endTime = parseSrtTimestamp(timeMatch[2]);
        const text = lines.slice(timeLineIdx + 1).join('\n').trim();
        cues.push({
          id: cues.length + 1,
          startTime,
          endTime,
          text
        });
      }
    }
  }

  return cues;
}

/**
 * Format seconds into ASS timestamp string: H:MM:SS.cc (e.g. 0:01:05.50)
 */
export function formatAssTimestamp(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const totalMillis = Math.round(seconds * 1000);
  const hours = Math.floor(totalMillis / 3600000);
  const remainderAfterHours = totalMillis % 3600000;
  const minutes = Math.floor(remainderAfterHours / 60000);
  const remainderAfterMinutes = remainderAfterHours % 60000;
  const secs = Math.floor(remainderAfterMinutes / 1000);
  const centis = Math.floor((remainderAfterMinutes % 1000) / 10);

  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${hours}:${pad(minutes)}:${pad(secs)}.${pad(centis, 2)}`;
}

/**
 * Generate standard Advanced SubStation Alpha (ASS) file format with precise positioning,
 * bold A ka 07 Myanmar font, responsive sizing, and outlined text.
 */
export function generateAssContent(
  cues: SubtitleCue[],
  videoWidth = 1080,
  videoHeight = 1920
): string {
  const isPortrait = videoHeight > videoWidth;

  // Font size responsive to video height: ~2.4% for portrait, ~3.8% for landscape
  const fontSize = isPortrait
    ? Math.max(28, Math.round(videoHeight * 0.024))
    : Math.max(20, Math.round(videoHeight * 0.038));

  // Keep subtitles near the bottom while leaving room for video controls and framing.
  const marginV = Math.round(videoHeight * 0.10);

  const outline = isPortrait ? 3 : 2;
  const marginLR = isPortrait ? 40 : 60;

  const header = `[Script Info]
Title: Burmese Movie Recap Subtitles
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,A ka 07,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,1,${outline},0,2,${marginLR},${marginLR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = cues
    .map((cue) => {
      const startStr = formatAssTimestamp(cue.startTime);
      const endStr = formatAssTimestamp(cue.endTime);
      // Strictly max 1-2 lines formatted with ASS \\N line break
      const formattedLines = breakBurmeseLines(cue.text, isPortrait ? 38 : 46);
      const textAss = formattedLines
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .slice(0, 2)
        .join('\\N');
      return `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${textAss}`;
    })
    .join('\n');

  return header + events + '\n';
}

/**
 * Break long Burmese sentences into readable lines for on-screen subtitles.
 * Ensures maximum 1–2 lines at a time.
 * Uses Myanmar punctuation (။, ၊) and spaces for natural breaks without cutting words.
 */
export function breakBurmeseLines(text: string, maxCharsPerLine = 42): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxCharsPerLine) {
    return trimmed;
  }

  // If text already has line breaks, ensure maximum 2 lines
  if (trimmed.includes('\n')) {
    const rawLines = trimmed.split('\n').filter((l) => l.trim().length > 0);
    if (rawLines.length <= 2) {
      return rawLines.join('\n');
    }
    return `${rawLines[0]}\n${rawLines.slice(1).join(' ')}`.slice(0, 160);
  }

  // Look for Myanmar clause separators (၊ or ။ or space) near center
  const mid = Math.floor(trimmed.length / 2);
  const separators = ['၊', '။', ' ', '...'];
  let bestBreakIndex = -1;
  let minDistance = Infinity;

  for (const sep of separators) {
    let idx = trimmed.indexOf(sep);
    while (idx !== -1) {
      const dist = Math.abs(idx - mid);
      if (dist < minDistance && idx > 8 && idx < trimmed.length - 8) {
        minDistance = dist;
        bestBreakIndex = idx + (sep === ' ' ? 0 : 1);
      }
      idx = trimmed.indexOf(sep, idx + 1);
    }
  }

  if (bestBreakIndex !== -1) {
    const part1 = trimmed.slice(0, bestBreakIndex).trim();
    const part2 = trimmed.slice(bestBreakIndex).trim();
    return `${part1}\n${part2}`;
  }

  // If no natural punctuation found, break at closest space or mid-point
  const spaceIdx = trimmed.indexOf(' ', Math.floor(trimmed.length * 0.4));
  if (spaceIdx !== -1 && spaceIdx < Math.floor(trimmed.length * 0.7)) {
    return `${trimmed.slice(0, spaceIdx).trim()}\n${trimmed.slice(spaceIdx).trim()}`;
  }

  return trimmed;
}

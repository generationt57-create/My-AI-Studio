import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSrtTimestamp,
  parseSrtTimestamp,
  generateSrtContent,
  generateVttContent,
  parseSrtContent,
  breakBurmeseLines,
  formatAssTimestamp,
  generateAssContent
} from './subtitle';

test('formatSrtTimestamp formats seconds to SRT standard format', () => {
  assert.equal(formatSrtTimestamp(0), '00:00:00,000');
  assert.equal(formatSrtTimestamp(65.5), '00:01:05,500');
  assert.equal(formatSrtTimestamp(3661.123), '01:01:01,123');
});

test('parseSrtTimestamp parses HH:MM:SS,mmm string to seconds', () => {
  assert.equal(parseSrtTimestamp('00:00:00,000'), 0);
  assert.equal(parseSrtTimestamp('00:01:05,500'), 65.5);
  assert.equal(parseSrtTimestamp('01:01:01.123'), 3661.123);
});

test('generateSrtContent and parseSrtContent roundtrip properly', () => {
  const cues = [
    { id: 1, startTime: 1.0, endTime: 4.5, text: 'မင်္ဂလာပါ ဇာတ်ကားပြန်ပြောပြခြင်းဖြစ်ပါတယ်။' },
    { id: 2, startTime: 5.0, endTime: 8.2, text: 'အဓိကဇာတ်ကောင်သည် မြို့တော်သို့ ရောက်ရှိလာခဲ့သည်။' }
  ];

  const srt = generateSrtContent(cues);
  assert.ok(srt.includes('00:00:01,000 --> 00:00:04,500'));
  assert.ok(srt.includes('မင်္ဂလာပါ'));

  const parsed = parseSrtContent(srt);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].text, 'မင်္ဂလာပါ ဇာတ်ကားပြန်ပြောပြခြင်းဖြစ်ပါတယ်။');
  assert.equal(parsed[0].startTime, 1.0);
  assert.equal(parsed[0].endTime, 4.5);
  assert.equal(parsed[1].startTime, 5.0);
  assert.equal(parsed[1].endTime, 8.2);
});

test('generateVttContent uses WebVTT timestamps and preserves cue text', () => {
  const vtt = generateVttContent([
    { id: 1, startTime: 1.25, endTime: 3.5, text: 'မြန်မာစာတန်း စမ်းသပ်ချက်' },
  ]);

  assert.ok(vtt.startsWith('WEBVTT\n\n'));
  assert.ok(vtt.includes('00:00:01.250 --> 00:00:03.500'));
  assert.ok(vtt.includes('မြန်မာစာတန်း စမ်းသပ်ချက်'));
});

test('breakBurmeseLines splits long Burmese text cleanly at punctuation or spaces', () => {
  const shortText = 'မင်္ဂလာပါခင်ဗျာ။';
  assert.equal(breakBurmeseLines(shortText, 30), shortText);

  const longText = 'ရှေးခေတ်ကာလတစ်ခုတွင် ဧကရာဇ်မင်းသည် တိုင်းပြည်ကို အုပ်ချုပ်နေစဉ်၊ ရန်သူများက နယ်စပ်ကို ကျူးကျော်လာခဲ့ကြသည်။';
  const broken = breakBurmeseLines(longText, 40);
  assert.ok(broken.includes('\n'), 'Should contain line break');
  assert.ok(broken.length >= longText.length, 'Should preserve full text content');
  const lines = broken.split('\n');
  assert.ok(lines.length <= 2, 'Should not exceed 2 lines');
});

test('formatAssTimestamp formats seconds to ASS standard H:MM:SS.cc', () => {
  assert.equal(formatAssTimestamp(0), '0:00:00.00');
  assert.equal(formatAssTimestamp(1.5), '0:00:01.50');
  assert.equal(formatAssTimestamp(65.52), '0:01:05.52');
  assert.equal(formatAssTimestamp(3661.12), '1:01:01.12');
});

test('generateAssContent generates valid ASS format with portrait lower-center position', () => {
  const cues = [
    { id: 1, startTime: 0.5, endTime: 3.5, text: 'ဒီနေ့ဇာတ်လမ်းလေးမှာတော့ စီးပွားရေးလုပ်ငန်းတွေ ကျဆင်းလာတာကို တင်ဆက်ပေးမှာ ဖြစ်ပါတယ်။' }
  ];

  // Portrait (1080x1920)
  const portraitAss = generateAssContent(cues, 1080, 1920);
  assert.ok(portraitAss.includes('PlayResX: 1080'));
  assert.ok(portraitAss.includes('PlayResY: 1920'));
  assert.ok(portraitAss.includes('Style: Default,A ka 07,46,&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,-1'));
  assert.ok(portraitAss.includes(',1,3,0,2,40,40,'));
  assert.ok(portraitAss.includes('ဒီနေ့ဇာတ်လမ်း'));
  // MarginV should be 10% of 1920 = 192
  assert.ok(portraitAss.includes(',192,1'));
  assert.ok(portraitAss.includes('Dialogue: 0,0:00:00.50,0:00:03.50,Default,,0,0,0,,'));

  // Landscape (1280x720)
  const landscapeAss = generateAssContent(cues, 1280, 720);
  assert.ok(landscapeAss.includes('PlayResX: 1280'));
  assert.ok(landscapeAss.includes('PlayResY: 720'));
  // MarginV should be ~10% of 720 = 72
  assert.ok(landscapeAss.includes(',72,1'));
  assert.ok(landscapeAss.includes('Style: Default,A ka 07,27,'));
});

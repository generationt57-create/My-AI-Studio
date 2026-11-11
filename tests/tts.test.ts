import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { synthesizeBurmeseWithGoogle, BURMESE_VOICES } from '../server/tts';

test('BURMESE_VOICES list contains NilarNeural and ThihaNeural', () => {
  assert.equal(BURMESE_VOICES.length, 2);
  assert.equal(BURMESE_VOICES[0].id, 'my-MM-NilarNeural');
  assert.equal(BURMESE_VOICES[1].id, 'my-MM-ThihaNeural');
});

test('synthesizeBurmeseWithGoogle synthesizes real Burmese audio', async () => {
  const testOut = path.join('/tmp', `test_gtts_${Date.now()}.mp3`);
  try {
    const success = await synthesizeBurmeseWithGoogle(
      'မင်္ဂလာပါ၊ My AI Studio မှ ကြိုဆိုပါသည်။',
      testOut
    );
    assert.equal(success, true);
    assert.equal(fs.existsSync(testOut), true);
    const stat = fs.statSync(testOut);
    assert.ok(stat.size > 1000, `Expected audio size > 1000, got ${stat.size}`);
  } finally {
    if (fs.existsSync(testOut)) {
      fs.unlinkSync(testOut);
    }
  }
});

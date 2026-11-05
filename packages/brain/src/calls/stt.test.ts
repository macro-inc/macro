import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDeepgram } from './stt.ts';

const results = (
  transcript: string,
  is_final: boolean,
  speech_final = false
) => ({
  type: 'Results',
  is_final,
  speech_final,
  channel: { alternatives: [{ transcript }] },
});
test('Deepgram messages map to STT events', () => {
  assert.deepStrictEqual(parseDeepgram({ type: 'SpeechStarted' }), {
    kind: 'speech_started',
  });
  assert.deepStrictEqual(parseDeepgram({ type: 'UtteranceEnd' }), {
    kind: 'utterance_end',
  });
  assert.deepStrictEqual(parseDeepgram(results('hel', false)), {
    kind: 'interim',
    text: 'hel',
  });
  assert.deepStrictEqual(parseDeepgram(results('Hello?', true, true)), {
    kind: 'final',
    text: 'Hello?',
    speechFinal: true,
  });
  assert.strictEqual(parseDeepgram({ type: 'Metadata' }), null);
});
test('empty interims are dropped, an empty speech_final still ends speech', () => {
  assert.strictEqual(parseDeepgram(results('', false)), null);
  assert.strictEqual(parseDeepgram(results('', true)), null);
  assert.deepStrictEqual(parseDeepgram(results('', true, true)), {
    kind: 'final',
    text: '',
    speechFinal: true,
  });
});

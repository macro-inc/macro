import { expect } from 'jsr:@std/expect@1';

const test = Deno.test;

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
  expect(parseDeepgram({ type: 'SpeechStarted' })).toEqual({
    kind: 'speech_started',
  });
  expect(parseDeepgram({ type: 'UtteranceEnd' })).toEqual({
    kind: 'utterance_end',
  });
  expect(parseDeepgram(results('hel', false))).toEqual({
    kind: 'interim',
    text: 'hel',
  });
  expect(parseDeepgram(results('Hello?', true, true))).toEqual({
    kind: 'final',
    text: 'Hello?',
    speechFinal: true,
  });
  expect(parseDeepgram({ type: 'Metadata' })).toBeNull();
});

test('empty interims are dropped, an empty speech_final still ends speech', () => {
  expect(parseDeepgram(results('', false))).toBeNull();
  expect(parseDeepgram(results('', true))).toBeNull();
  expect(parseDeepgram(results('', true, true))).toEqual({
    kind: 'final',
    text: '',
    speechFinal: true,
  });
});

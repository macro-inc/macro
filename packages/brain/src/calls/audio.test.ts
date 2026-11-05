import { expect } from 'jsr:@std/expect@1';

const test = Deno.test;

import { encodeWav, frames, Gain, level, parseWav, resample } from './audio.ts';

const tone = (n: number, amp: number) =>
  Int16Array.from({ length: n }, (_, i) => Math.round(amp * Math.sin(i / 5)));

test('WAV round-trips', () => {
  const samples = tone(1600, 1000);
  const back = parseWav(encodeWav({ rate: 16000, samples }));
  expect(back.rate).toBe(16000);
  expect([...back.samples]).toEqual([...samples]);
});

test('a WAV cut off mid-write (header size 0) still parses', () => {
  const w = encodeWav({ rate: 16000, samples: tone(320, 500) });
  new DataView(w.buffer).setUint32(40, 0, true);
  expect(parseWav(w).samples.length).toBe(320);
});

test('level reports peak, rms, dBFS', () => {
  expect(level(new Int16Array(10))).toEqual({ peak: 0, rms: 0, dbfs: -120 });
  const l = level(Int16Array.from([3000, -3000]));
  expect(l.peak).toBe(3000);
  expect(l.dbfs).toBe(-21);
});

test('resample changes length by the rate ratio', () => {
  expect(resample(tone(48000, 100), 48000, 16000).length).toBe(16000);
});

test('frames pads the tail', () => {
  const f = [...frames(new Int16Array(500), 320)];
  expect(f.map((x) => x.length)).toEqual([320, 320]);
});

test('gain lifts quiet speech toward -21 dBFS and leaves the noise floor near silence', () => {
  const g = new Gain();
  let out: Int16Array = new Int16Array();
  for (let i = 0; i < 30; i++) out = g.apply(tone(320, 300)); // -40 dBFS "Hello?"
  expect(level(out).rms).toBeGreaterThan(2000);
  const floor = g.apply(
    Int16Array.from({ length: 320 }, (_, i) => (i % 7 === 0 ? 1 : 0))
  );
  expect(level(floor).peak).toBeLessThanOrEqual(Gain.MAX);
});

test('gain never cuts loud speech below unity or clips it into garbage', () => {
  const g = new Gain();
  const out = g.apply(tone(320, 20000));
  expect(level(out).peak).toBeLessThanOrEqual(32767);
  expect(g.gain).toBe(1);
});

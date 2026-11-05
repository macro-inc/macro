import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after as afterAll, test } from 'node:test';
import { encodeWav, frames, level, parseWav } from './audio.ts';
import { Segmenter, trimDelivered } from './ear.ts';
import { replayPcm, replayWav } from './replay.ts';
import type { SttFactory } from './stt.ts';

const FIX = new URL('./fixtures/1', import.meta.url).pathname;
const expected = JSON.parse(await readFile(`${FIX}/expected.json`, 'utf8'));
const noop = () => {};
const RATE = 16000;
const tmp = mkdtempSync(join(tmpdir(), 'ear-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
/** A gated client's floor: zeros and +/-1, the same every run. */
function gatedFloor(seconds: number): Int16Array {
  let x = 1;
  return Int16Array.from({ length: seconds * RATE }, () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    const r = x / 2147483648;
    return r < 0.05 ? 1 : r < 0.1 ? -1 : 0;
  });
}
/** A vowel-like tone at 120 Hz with harmonics and 30 ms ramps, scaled to dbfs RMS. */
function voiced(ms: number, dbfs: number): Int16Array {
  const n = Math.round((ms / 1000) * RATE);
  const ramp = 0.03 * RATE;
  const raw = Float64Array.from({ length: n }, (_, i) => {
    let v = 0;
    for (let h = 1; h <= 8; h++)
      v += Math.sin((2 * Math.PI * 120 * h * i) / RATE) / h;
    return v * Math.min(1, i / ramp, (n - i) / ramp);
  });
  const rms = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0) / n);
  const scale = (32768 * 10 ** (dbfs / 20)) / rms;
  return Int16Array.from(raw, (v) => Math.round(v * scale));
}
function writeWav(name: string, samples: Int16Array): string {
  const path = join(tmp, name);
  writeFileSync(path, encodeWav({ rate: RATE, samples }));
  return path;
}
const at = (t: number) => Math.round(t * RATE);
const GATED = expected['noise-gated'];
const gatedPcm = gatedFloor(GATED.seconds);
for (const t of GATED.segments)
  gatedPcm.set(voiced(GATED.burstMs, GATED.dbfs), at(t));
const gatedWav = writeWav('noise-gated.wav', gatedPcm);
const NORMAL = expected['normal-level'];
const [phraseStart, phraseEnd] = NORMAL.phrase;
const normalPcm = gatedFloor(NORMAL.seconds);
normalPcm.set(
  voiced((phraseEnd - phraseStart) * 1000, NORMAL.dbfs),
  at(phraseStart)
);
const normalWav = writeWav('normal-level.wav', normalPcm);
test('synthetic calls have the shape of the real failures', () => {
  const bursts = GATED.segments.map((t: number) => [
    at(t),
    at(t + GATED.burstMs / 1000),
  ]);
  for (const [from, to] of bursts)
    assert.strictEqual(level(gatedPcm.subarray(from, to)).dbfs, GATED.dbfs);
  const floor = gatedPcm.filter(
    (_, i) => !bursts.some(([from, to]: number[]) => i >= from! && i < to!)
  );
  assert.strictEqual(Math.max(...new Set(floor)), 1);
  assert.strictEqual(Math.min(...new Set(floor)), -1);
  assert.strictEqual(
    level(normalPcm.subarray(at(phraseStart), at(phraseEnd))).dbfs,
    NORMAL.dbfs
  );
});
/** Streaming STT as it behaved on recorded failure: hears speech, returns no words. */
const deafStream: SttFactory = (_who, on) => ({
  send() {},
  async close() {
    on({ kind: 'final', text: '', speechFinal: true });
  },
});
test('segmenter finds the three noise-gated bursts, shaped like call recorded failure', async () => {
  const w = parseWav(new Uint8Array(await readFile(gatedWav)));
  const seg = new Segmenter();
  const found: {
    start: number;
    end: number;
  }[] = [];
  for (const f of frames(w.samples, 320)) {
    const s = seg.push(f);
    if (s) found.push(s);
  }
  assert.strictEqual(found.length, GATED.answered);
  found.forEach((s, i) => {
    assert(Math.abs(s.start / 1000 - GATED.segments[i]) < 0.1);
    assert(Math.abs(s.end - s.start - GATED.burstMs) < 100);
  });
});
test('segmenter ignores the noise floor and a lone click', () => {
  const seg = new Segmenter();
  let n = 0;
  const quiet = Int16Array.from({ length: 320 }, (_, i) => (i % 9 ? 0 : 1));
  const click = Int16Array.from({ length: 320 }, (_, i) => (i < 20 ? 8000 : 0));
  for (let i = 0; i < 200; i++) if (seg.push(i === 100 ? click : quiet)) n++;
  assert.strictEqual(n, 0);
});
test('recorded failure regression: deaf streaming STT, rescue finds the words, Tod is asked all three', async () => {
  const words = ['Hello?', 'Hello?', 'Tod.'];
  let k = 0;
  const r = await replayWav(gatedWav, {
    stt: deafStream,
    rescue: async () => words[k++] ?? '',
    emit: noop,
  });
  assert.deepStrictEqual(r.asks, words);
  assert.strictEqual(r.asks.length, GATED.answered);
});
test('recorded failure regression: even when rescue finds nothing, a 1:1 caller gets "didn\'t catch that"', async () => {
  const r = await replayWav(gatedWav, {
    stt: deafStream,
    rescue: async () => '',
    emit: noop,
  });
  assert(r.asks.length >= 1);
  assert.strictEqual(
    r.asks.every((a) => a.startsWith('(say)')),
    true
  );
});
test('when streaming hears the words, no rescue call is made', async () => {
  let rescues = 0;
  const hearing: SttFactory = (_who, on) => {
    let n = 0;
    return {
      send() {
        if (++n % 25 === 0)
          on({ kind: 'final', text: 'hey', speechFinal: false });
      },
      async close() {},
    };
  };
  let segments = 0;
  const r = await replayWav(normalWav, {
    stt: hearing,
    rescue: async () => (rescues++, 'x'),
    emit: (t) => t === 'ear.segment' && segments++,
  });
  assert(segments > 0); // the ear did notice speech
  assert.strictEqual(rescues, 0);
  assert(r.asks.length > 0);
});
test('recorded failure regression: words streaming showed only as an interim are used when rescue is empty', async () => {
  const interimOnly: SttFactory = (_who, on) => {
    let n = 0;
    return {
      send() {
        if (++n === 80) on({ kind: 'interim', text: 'Hi.' });
        if (n === 170) on({ kind: 'final', text: '', speechFinal: true });
      },
      async close() {},
    };
  };
  const r = await replayWav(normalWav, {
    stt: interimOnly,
    rescue: async () => '',
    emit: noop,
  });
  assert.deepStrictEqual(r.asks, ['Hi.']);
  assert.strictEqual(r.asks.length, NORMAL.answered);
});
const speechThenQuiet = (speechMs = 1000, totalMs = 6000) =>
  Int16Array.from({ length: (totalMs / 1000) * 16000 }, (_, i) =>
    i < (speechMs / 1000) * 16000
      ? Math.round(3000 * Math.sin(i / 6))
      : i % 13
        ? 0
        : 1
  );
test('probe recorded failure/recorded failure regression: streaming holds a sentence as interims for seconds; rescue transcribes it, asked once, late final dropped', async () => {
  const slow: SttFactory = (_who, on) => {
    let n = 0;
    return {
      send() {
        n++;
        if (n === 45)
          on({
            kind: 'interim',
            text: 'What is two plus two?',
            startMs: 0,
            endMs: 900,
          });
        if (n === 250)
          on({
            kind: 'final',
            text: 'What is two plus two?',
            speechFinal: true,
            startMs: 0,
            endMs: 1000,
          });
      },
      async close() {},
    };
  };
  const r = await replayPcm(speechThenQuiet(), 16000, {
    stt: slow,
    rescue: async () => 'What is two plus two?',
    emit: noop,
  });
  assert.deepStrictEqual(r.asks, ['What is two plus two?']);
  const ask = r.actions.find((a) => a.action.type === 'ask')!;
  assert(ask.t < 3200); // not the 5 s final
});
test('a streaming final that arrives after the rescue delivered the same audio is dropped', async () => {
  const late: SttFactory = (_who, on) => {
    let n = 0;
    return {
      send() {
        if (++n === 200)
          on({
            kind: 'final',
            text: 'Hello?',
            speechFinal: true,
            startMs: 0,
            endMs: 1000,
          });
      },
      async close() {},
    };
  };
  const r = await replayPcm(speechThenQuiet(), 16000, {
    stt: late,
    rescue: async () => 'Hello?',
    emit: noop,
  });
  assert.deepStrictEqual(r.asks, ['Hello?']);
});
test('probe recorded failure regression: an interim that stops short of the end of the speech is not promoted', async () => {
  const lagging: SttFactory = (_who, on) => {
    let n = 0;
    return {
      send() {
        n++;
        if (n === 30)
          on({
            kind: 'interim',
            text: 'Hey, Tod. Can',
            startMs: 0,
            endMs: 500,
          });
        if (n === 110)
          on({
            kind: 'final',
            text: 'Hey, Tod. Can you hear me?',
            speechFinal: true,
            startMs: 0,
            endMs: 1000,
          });
      },
      async close() {},
    };
  };
  const r = await replayPcm(speechThenQuiet(), 16000, {
    stt: lagging,
    rescue: async () => 'x',
    emit: noop,
  });
  assert.deepStrictEqual(r.asks, ['Hey, Tod. Can you hear me?']);
});
test('trimDelivered keeps only the new words of an overlapping final', () => {
  assert.strictEqual(
    trimDelivered(
      'Stop. Sorry. Quick one. What is two plus',
      'Stop. Sorry. Quick one.'
    ),
    'What is two plus'
  );
  assert.strictEqual(
    trimDelivered('Stop sorry quick one', 'Stop. Sorry. Quick one.'),
    ''
  );
  assert.strictEqual(
    trimDelivered('Something else entirely', 'Stop. Sorry.'),
    'Something else entirely'
  );
  assert.strictEqual(
    trimDelivered(
      'Stop. Sorry. Quick one. One is two plus two.',
      'Stop sorry quick one what is two plus two'
    ),
    ''
  );
});
test('probe recorded failure regression: a pause between sentences does not split one turn into two asks', async () => {
  const pcm = Int16Array.from({ length: 6 * 16000 }, (_, i) => {
    const t = i / 16000;
    return t < 1 || (t > 1.6 && t < 2.6)
      ? Math.round(3000 * Math.sin(i / 6))
      : i % 13
        ? 0
        : 1;
  });
  const fake: SttFactory = (_who, on) => {
    let n = 0;
    return {
      send() {
        n++;
        if (n === 52)
          on({
            kind: 'interim',
            text: 'Stop. Sorry. Quick one.',
            startMs: 0,
            endMs: 1000,
          });
        if (n === 100)
          on({
            kind: 'interim',
            text: 'Stop. Sorry. Quick one. What is',
            startMs: 0,
            endMs: 1900,
          });
        if (n === 170)
          on({
            kind: 'final',
            text: 'Stop. Sorry. Quick one. What is two plus two?',
            speechFinal: true,
            startMs: 0,
            endMs: 2600,
          });
      },
      async close() {},
    };
  };
  const r = await replayPcm(pcm, 16000, {
    stt: fake,
    rescue: async () => 'x',
    emit: noop,
  });
  assert(
    !r.asks
      .join(' | ')
      .replace(/Stop\. Sorry\. Quick one\. /, '')
      .includes('Stop.')
  );
  assert(r.asks.at(-1).includes('What is two plus two?'));
});
test('probe recorded failure regression: a re-sent interim for words already delivered is dropped, not a new line', async () => {
  const resend: SttFactory = (_who, on) => {
    let n = 0;
    return {
      send() {
        n++;
        if (n === 52)
          on({
            kind: 'interim',
            text: 'What is two plus two?',
            startMs: 0,
            endMs: 1000,
          });
        if (n === 160)
          on({
            kind: 'interim',
            text: 'What is two plus two?',
            startMs: 0,
            endMs: 3200,
          });
        if (n === 260)
          on({
            kind: 'final',
            text: 'What is two plus two?',
            speechFinal: true,
            startMs: 0,
            endMs: 3300,
          });
      },
      async close() {},
    };
  };
  const seen: string[] = [];
  const r = await replayPcm(speechThenQuiet(), 16000, {
    stt: resend,
    rescue: async () => 'What is two plus two?',
    emit: (t, d) => t === 'turn.ask' && seen.push(String(d?.text)),
  });
  assert.deepStrictEqual(r.asks, ['What is two plus two?']);
});
test('live probe recorded failure regression: Deepgram VAD + empty final with no local segment still gets resolved (never silent)', async () => {
  const pcm = Int16Array.from({ length: 5 * 16000 }, (_, i) =>
    i % 13 ? 0 : 1
  );
  const vadOnly: SttFactory = (_who, on) => {
    let n = 0;
    return {
      send() {
        n++;
        if (n === 50) on({ kind: 'speech_started' });
        if (n === 80) on({ kind: 'final', text: '', speechFinal: true });
      },
      async close() {},
    };
  };
  let rescued = 0;
  const r = await replayPcm(pcm, 16000, {
    stt: vadOnly,
    rescue: async () => (rescued++, ''),
    emit: noop,
  });
  assert.strictEqual(rescued, 1);
  assert.deepStrictEqual(r.asks, ["(say) Sorry, didn't catch that."]);
});

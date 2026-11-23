import { expect, test } from 'bun:test';
import {
  closeSync,
  constants,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { parseWav } from '../audio.ts';
import { callDisk, diskWorker } from '../context/disk.ts';
import {
  eventLog,
  loopEveryMs,
  loopLogMs,
  trackRecorder,
  watchLoop,
} from '../events.ts';
import { CallEvent } from '../types.ts';

const eventsFile = 'events.jsonl';
const here = join(import.meta.dir, '..');
const temporary = () => mkdtempSync(join(tmpdir(), 'ev-'));
const lines = (file: string): readonly CallEvent[] =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => CallEvent.parse(JSON.parse(line)));

/** The call clock, moved by hand. */
const callClock = () => {
  let at = 0;
  return {
    elapsed: () => at,
    move: (ms: number) => {
      at += ms;
    },
  };
};

test('the events file gets one JSON line per event with ms timestamps', () => {
  const directory = temporary();
  const clock = callClock();
  const disk = callDisk();
  const log = eventLog({ file: join(directory, eventsFile), disk, ...clock });
  clock.move(12.4);
  log.emit('stt.final', { who: 'a', text: 'hi' });
  log.close();
  expect(disk.flush(5000)).toBe(true);
  expect(lines(join(directory, eventsFile))).toEqual([
    { t: 12, type: 'stt.final', who: 'a', text: 'hi' },
  ]);
});

test('a log without a file only echoes', () => {
  const echoed: string[] = [];
  const log = eventLog({ elapsed: () => 5, echo: (line) => echoed.push(line) });
  log.emit('turn.ask', { turn: 1 });
  log.close();
  expect(echoed).toEqual(['{"t":5,"type":"turn.ask","turn":1}']);
});

test('the track recorder writes a valid WAV and logs gaps and levels', () => {
  const directory = temporary();
  const clock = callClock();
  const disk = callDisk();
  const log = eventLog({ file: join(directory, eventsFile), disk, ...clock });
  const recorder = trackRecorder({
    path: join(directory, 'a.wav'),
    rate: 16000,
    log,
    disk,
    who: 'a',
  });
  clock.move(20);
  recorder.write(new Int16Array(320).fill(1000));
  clock.move(400);
  recorder.write(new Int16Array(320).fill(1000));
  recorder.close();
  log.close();
  expect(disk.flush(5000)).toBe(true);
  const wav = parseWav(new Uint8Array(readFileSync(join(directory, 'a.wav'))));
  expect(wav.rate).toBe(16000);
  expect(wav.samples.length).toBe(16000 * 0.42);
  expect(wav.samples[0]).toBe(1000);
  expect(wav.samples[320]).toBe(0);
  expect(wav.samples.at(-1)).toBe(1000);
  const events = lines(join(directory, eventsFile));
  expect(events.map(({ type }) => type)).toEqual(['audio.gap', 'audio.level']);
  expect(events[0]).toMatchObject({ who: 'a', ms: 380 });
});

// A stuck disk must never freeze the call's thread.
// A FIFO nobody reads is a disk that never comes back: the worker's open just sits there.
test('a stuck disk never holds up the thread, and what overflowed is dropped and accounted for', () => {
  const directory = temporary();
  const stuck = join(directory, eventsFile);
  expect(Bun.spawnSync(['mkfifo', stuck]).exitCode).toBe(0);
  const worker = diskWorker({ recording: 6400, lines: 2000 });
  const log = eventLog({ file: stuck, disk: worker, elapsed: () => 0 });

  const started = performance.now();
  for (let i = 0; i < 1000; i++) log.emit('tick', { i });
  expect(performance.now() - started).toBeLessThan(500);
  // Really stuck, and nobody waited on it.
  expect(worker.flush(100)).toBe(false);

  // The disk comes back.
  const reader = openSync(stuck, constants.O_RDONLY | constants.O_NONBLOCK);
  expect(worker.flush(5000)).toBe(true);
  log.emit('after');
  log.close();
  expect(worker.flush(5000)).toBe(true);
  const got = Bun.spawnSync(
    ['dd', 'if=/proc/self/fd/0', 'iflag=nonblock', 'status=none'],
    { stdin: reader }
  )
    .stdout.toString()
    .trim()
    .split('\n')
    .map((line) => CallEvent.parse(JSON.parse(line)));
  closeSync(reader);
  worker.stop();
  expect(got.length).toBeGreaterThan(0);
  expect(got.length).toBeLessThan(1000);
  const dropped = got.find(({ type }) => type === 'log.dropped');
  // The tick lines kept, then "after", then this one.
  expect(dropped?.events).toBe(1000 - (got.length - 2));
  expect(got.at(-2)?.type).toBe('after');
});

test('dropped audio leaves silence where it was, so the track stays aligned', () => {
  const directory = temporary();
  const stuck = join(directory, 'stuck');
  expect(Bun.spawnSync(['mkfifo', stuck]).exitCode).toBe(0);
  const worker = diskWorker({ recording: 6400, lines: 100_000 });
  const clock = callClock();
  const log = eventLog({
    file: join(directory, eventsFile),
    disk: worker,
    ...clock,
  });
  // Holds the worker at the head of the queue, so writes pile up behind it.
  const hold = worker.open(stuck, 'a');
  const recorder = trackRecorder({
    path: join(directory, 'a.wav'),
    rate: 16000,
    log,
    disk: worker,
    who: 'a',
  });
  const frame = new Int16Array(320).fill(1000);
  // 9 fit: 6400 bytes, less the 44 of the header, at 640 each.
  for (let i = 0; i < 50; i++) {
    clock.move(20);
    recorder.write(frame);
  }
  expect(worker.flush(50)).toBe(false);
  const reader = openSync(stuck, constants.O_RDONLY | constants.O_NONBLOCK);
  expect(worker.flush(5000)).toBe(true);
  // This one lands after the hole.
  clock.move(20);
  recorder.write(frame);
  recorder.close();
  worker.end(hold);
  log.emit('end');
  log.close();
  expect(worker.flush(5000)).toBe(true);
  closeSync(reader);
  worker.stop();
  const { samples } = parseWav(
    new Uint8Array(readFileSync(join(directory, 'a.wav')))
  );
  expect(samples.length).toBe(51 * 320);
  expect(samples[0]).toBe(1000);
  // The last one kept, then the dropped ones.
  expect(samples[8 * 320]).toBe(1000);
  expect(samples[9 * 320]).toBe(0);
  expect(samples[49 * 320]).toBe(0);
  // The last frame is where it belongs.
  expect(samples[50 * 320]).toBe(1000);
  const droppedMs = lines(join(directory, eventsFile))
    .filter(({ type }) => type === 'recording.dropped')
    .reduce((total, event) => total + z.number().parse(event.ms), 0);
  expect(droppedMs).toBe(41 * 20);
});

test('a recording that never closes is still a readable WAV', () => {
  const directory = temporary();
  const clock = callClock();
  const disk = callDisk();
  const log = eventLog({ file: join(directory, eventsFile), disk, ...clock });
  const recorder = trackRecorder({
    path: join(directory, 'a.wav'),
    rate: 16000,
    log,
    disk,
    who: 'a',
  });
  clock.move(20);
  recorder.write(new Int16Array(320).fill(1000));
  clock.move(1050);
  recorder.write(new Int16Array(320).fill(1000));
  log.close();
  expect(disk.flush(5000)).toBe(true);
  const wav = parseWav(new Uint8Array(readFileSync(join(directory, 'a.wav'))));
  expect(wav.samples.length).toBeGreaterThan(16000);
});

test('a process that exits right after an event still logs it', () => {
  const directory = temporary();
  const script = [
    `import { eventLog } from ${JSON.stringify(join(here, 'events.ts'))};`,
    `import { callDisk } from ${JSON.stringify(join(here, 'context', 'disk.ts'))};`,
    `const log = eventLog({ file: ${JSON.stringify(join(directory, eventsFile))}, disk: callDisk(), elapsed: () => 0 });`,
    `log.emit("join.failed", { stage: "token" });`,
    'process.exit(1);',
  ].join('\n');
  const ran = Bun.spawnSync([process.execPath, '--eval', script]);
  expect(ran.exitCode).toBe(1);
  expect(lines(join(directory, eventsFile))[0]).toMatchObject({
    type: 'join.failed',
    stage: 'token',
  });
});

test('watchLoop logs a late thread, and nothing when it runs freely', async () => {
  const seen: string[] = [];
  const lags: unknown[] = [];
  let at = 0;
  let ticks = 0;
  let onTick = () => {};
  const tick = () =>
    new Promise<void>((resolve) => {
      onTick = resolve;
    });
  const stop = watchLoop(
    (type, data) => {
      seen.push(type);
      if (type === 'loop.lag') lags.push(data?.ms);
    },
    () => {
      if (ticks++ > 0) onTick();
      return at;
    }
  );
  // On time: the interval fired exactly when it should.
  at += loopEveryMs;
  await tick();
  expect(seen).toEqual(['loop.watch']);
  // The thread was held three log thresholds past its tick.
  at += loopEveryMs + loopLogMs * 3;
  await tick();
  stop();
  expect(seen).toEqual(['loop.watch', 'loop.lag']);
  expect(lags).toEqual([loopLogMs * 3]);
});

test('nothing a live call runs writes on its thread', async () => {
  const context = join(here, 'context');
  const files = [
    ...['events', 'join', 'session', 'room', 'working', 'brain'].map((name) =>
      join(here, `${name}.ts`)
    ),
    ...readdirSync(context)
      .filter((name) => name.startsWith('voice'))
      .map((name) => join(context, name)),
  ];
  for (const file of files)
    expect(await Bun.file(file).text()).not.toMatch(
      /\bBun\.write\(|\b(writeSync|appendFileSync|writeFileSync)\(/
    );
});

/**
 * Checks the spans against the screen: records the device's screen while the
 * harness runs one step, finds the frame where the touch appears (Android's
 * "show touches" dot) and the frame from which the screen stops changing,
 * and compares that interval with the step's span-based time.
 *
 *   bun scripts/android-benchmark/visual.ts --serial emulator-5580 \
 *     --step document.large.open --iterations 5
 *
 * Needs ffmpeg on PATH (or FFMPEG=/path/to/ffmpeg).
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Device } from './device';
import {
  launchFresh,
  measureStep,
  prepare,
  sleep,
  waitForBootFlow,
} from './harness';
import { SCENARIOS } from './scenarios';
import { summarize } from './stats';
import { parseTargets } from './targets';
import { parseCpuThrottle } from './throttle';

const { values: options } = parseArgs({
  options: {
    serial: { type: 'string', default: process.env.ANDROID_SERIAL },
    step: { type: 'string', default: 'document.large.open' },
    variant: { type: 'string', default: 'cold' },
    iterations: { type: 'string', default: '5' },
    targets: {
      type: 'string',
      default: join(homedir(), '.config/macro-android-benchmark/targets.json'),
    },
    out: { type: 'string', default: 'android-benchmark-results' },
    port: { type: 'string', default: '9333' },
    'cpu-throttle': { type: 'string', default: '1' },
    // Keeps each recording; it shows real account content, so never commit it.
    keep: { type: 'boolean', default: false },
  },
});
if (!options.serial) {
  console.error('Pass --serial (or set ANDROID_SERIAL): adb -s is required');
  process.exit(2);
}

let cpuThrottle: number;
try {
  const rates = parseCpuThrottle(options['cpu-throttle']);
  if (rates.length > 1) throw new Error('--cpu-throttle takes one rate here');
  cpuThrottle = rates[0];
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
/** Frames are compared at 1/8 of the screen's resolution, in grey. */
const SCALE = 8;
const REMOTE = '/sdcard/macro-benchmark.mp4';

const device = new Device(options.serial);
const targetsFile = parseTargets(
  await readFile(options.targets, 'utf8').catch(() => '{}'),
  options.targets
);
const scenarioId = Object.keys(SCENARIOS).find((id) =>
  SCENARIOS[id].steps?.some((step) => step.id === options.step)
);
if (!scenarioId) throw new Error(`No scenario has a step ${options.step}`);
const scenario = SCENARIOS[scenarioId];
const steps = scenario.steps ?? [];
const stepIndex = steps.findIndex((step) => step.id === options.step);
// Each open step is followed by its back step, which needs the open first.
if (options.step.endsWith('.back'))
  throw new Error('Check an open step; a back step depends on the one before it');

type Frame = { time: number; pixels: Uint8Array };

async function frames(video: string, width: number, height: number) {
  const child = spawn(FFMPEG, [
    '-loglevel', 'info', '-i', video,
    '-vf', `scale=${width}:${height},format=gray,showinfo`,
    // Keep screenrecord's variable frame times: one output frame per input.
    '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
  ]);
  const chunks: Buffer[] = [];
  let log = '';
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });
  await new Promise((done) => child.on('close', done));
  const raw = Buffer.concat(chunks);
  const times = [...log.matchAll(/pts_time:([\d.]+)/g)].map((match) =>
    Number(match[1])
  );
  const size = width * height;
  const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
  return {
    list: times.map((time, index) => ({
      time: time * 1000,
      pixels: raw.subarray(index * size, (index + 1) * size),
    })),
    durationMs: duration
      ? (Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000
      : 0,
  };
}

/** How long the screen must stay unchanged after the last change. */
const STABLE_MS = 1000;

/** Mean absolute grey difference between two frames. */
function difference(a: Uint8Array, b: Uint8Array) {
  let total = 0;
  for (let index = 0; index < a.length; index++)
    total += Math.abs(a[index] - b[index]);
  return total / a.length;
}

/**
 * Touch-to-settled time from the video, in milliseconds. The target is in
 * place and the screen still before recording starts, so the first frame that
 * differs from the one before is the touch (the touch dot, or the row's
 * pressed state); the screen has settled at the first frame from which every
 * later frame matches the last one.
 */
function analyse({ list, durationMs }: { list: Frame[]; durationMs: number }) {
  const touched = list.findIndex(
    (frame, index) =>
      index > 0 && difference(frame.pixels, list[index - 1].pixels) > 0.2
  );
  const final = list.at(-1)?.pixels;
  if (touched < 0 || !final) return undefined;
  let settled = touched;
  for (let index = touched; index < list.length; index++)
    if (difference(list[index].pixels, final) > 1) settled = index + 1;
  const end = list[Math.min(settled, list.length - 1)];
  // A screen still changing when recording stopped has not settled.
  if (Math.max(durationMs, list.at(-1)?.time ?? 0) - end.time < STABLE_MS)
    return undefined;
  return { touchedAt: list[touched].time, settledMs: end.time - list[touched].time };
}

async function record(work: () => Promise<{ x: number; y: number; spanMs: number }>) {
  const recorder = spawn('adb', ['-s', device.serial, 'shell', 'screenrecord', '--bit-rate', '16000000', REMOTE]);
  const stopped = new Promise((done) => recorder.on('close', done));
  try {
    await sleep(1500);
    const result = await work();
    await sleep(2000);
    await device.shell('pkill -INT screenrecord');
    await stopped;
    await sleep(500);
    const directory = await mkdtemp(join(tmpdir(), 'macro-benchmark-'));
    const local = join(directory, 'step.mp4');
    try {
      await device.adb('pull', REMOTE, local);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    return { ...result, video: local, directory };
  } finally {
    await device.shell('pkill -INT screenrecord || true');
    await device.shell(`rm -f ${REMOTE}`);
  }
}

const touches = (await device.shell('settings get system show_touches')).trim();
const restoreTouches = () =>
  device.shell(`settings put system show_touches ${touches === '1' ? 1 : 0}`);
// Ctrl-C skips the finally blocks: stop and delete the recording (it shows
// account content), drop the forward, and restore the setting first.
process.on('SIGINT', async () => {
  await device.shell('pkill -INT screenrecord || true').catch(() => '');
  await device.shell(`rm -f ${REMOTE}`).catch(() => '');
  await device.removeForward(Number(options.port));
  await restoreTouches();
  process.exit(130);
});
await device.shell('settings put system show_touches 1');
const size = (await device.shell('wm size')).match(/(\d+)x(\d+)/);
const width = Math.round(Number(size?.[1] ?? 1080) / SCALE);
const height = Math.round(Number(size?.[2] ?? 2400) / SCALE);
const rows: { iteration: number; spanMs: number; visualMs: number | undefined }[] = [];
try {
  for (let iteration = 0; iteration < Number(options.iterations); iteration++) {
    const { session, launched } = await launchFresh(device, Number(options.port));
    try {
      await session.throttleCpu(cpuThrottle);
      await waitForBootFlow(session, launched);
      await sleep(5000);
      const { targets } = await prepare(session, scenario, targetsFile, 3000);
      // Cold: the steps before this one. Warm: those, this one, and then a
      // step that leaves it (its back step, or another view).
      const leave = steps[stepIndex + 1] ?? steps.find((_, index) => index !== stepIndex);
      const before =
        options.variant === 'warm' && leave
          ? [...steps.slice(0, stepIndex + 1), leave]
          : steps.slice(0, stepIndex);
      for (const step of before) {
        await measureStep(session, step, targets, 'cold', iteration);
        await sleep(1500);
      }
      const step = steps[stepIndex];
      // Scroll the target into place before recording, so the first change
      // in the recording is the touch.
      const point = await session.waitFor(step.target(targets));
      await sleep(500);
      const recorded = await record(async () => {
        // Android draws the touch dot only while the finger is down.
        const sample = await measureStep(session, step, targets, 'cold', iteration, 120);
        return { ...point, spanMs: sample.readyMs };
      });
      let visual: ReturnType<typeof analyse>;
      try {
        visual = analyse(await frames(recorded.video, width, height));
      } finally {
        // Recordings show account content: keep them only when asked.
        if (options.keep)
          console.log(`  recording: ${recorded.video}`);
        else await rm(recorded.directory, { recursive: true, force: true });
      }
      rows.push({ iteration, spanMs: recorded.spanMs, visualMs: visual?.settledMs });
      console.log(
        `  ${iteration} span ${Math.round(recorded.spanMs)} ms, screen ${visual ? Math.round(visual.settledMs) : '-'} ms`
      );
    } catch (error) {
      console.warn(`  ${iteration} failed: ${(error as Error).message}`);
    } finally {
      await session.detach();
    }
  }
} finally {
  await restoreTouches();
}

const paired = rows.filter((row) => row.visualMs !== undefined);
const span = summarize(paired.map((row) => row.spanMs));
const screen = summarize(paired.map((row) => row.visualMs ?? 0));
const gap = summarize(paired.map((row) => (row.visualMs ?? 0) - row.spanMs));
console.log(
  `${options.step} (${options.variant}, CPU throttle ${cpuThrottle}×), n=${paired.length}: span median ${Math.round(span.median)} ms, screen median ${Math.round(screen.median)} ms, screen − span median ${Math.round(gap.median)} ms (min ${Math.round(gap.min)}, max ${Math.round(gap.max)})`
);
await mkdir(resolve(options.out), { recursive: true });
const file = resolve(options.out, `visual-${options.step}-${Date.now()}-cpu${cpuThrottle}x.json`);
await writeFile(file, `${JSON.stringify({ step: options.step, variant: options.variant, cpuThrottle, rows }, null, 2)}\n`);
console.log(`Results: ${file}`);
process.exit(0);

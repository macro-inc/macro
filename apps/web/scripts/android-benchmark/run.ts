/**
 * Android performance benchmark. Drives the benchmark build on one emulator
 * or device through DevTools and adb, reads the app's own perf spans, writes
 * JSON results and prints a summary. It only taps through views and opens
 * items: it never types, sends, edits or changes settings.
 *
 *   bun scripts/android-benchmark/run.ts --serial emulator-5580 \
 *     --targets ~/.config/macro-android-benchmark/targets.json
 *
 * See README.md in this directory.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Device } from './device';
import { launchFresh, measureStep, prepare, sleep } from './harness';
import { type Sample, sampleFrom } from './measure';
import { SCENARIOS, type Targets } from './scenarios';
import { summarize } from './stats';

const { values: options } = parseArgs({
  options: {
    serial: { type: 'string', default: process.env.ANDROID_SERIAL },
    iterations: { type: 'string', default: '10' },
    scenarios: { type: 'string', default: Object.keys(SCENARIOS).join(',') },
    targets: {
      type: 'string',
      default: join(homedir(), '.config/macro-android-benchmark/targets.json'),
    },
    out: { type: 'string', default: 'android-benchmark-results' },
    port: { type: 'string', default: '9333' },
    settle: { type: 'string', default: '1500' },
    'boot-settle': { type: 'string', default: '5000' },
    label: { type: 'string', default: '' },
  },
});

if (!options.serial) {
  console.error('Pass --serial (or set ANDROID_SERIAL): adb -s is required');
  process.exit(2);
}

/** Parses a numeric option, exiting when it is outside its range. */
function numberOption(name: string, value: string, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    console.error(`--${name} must be an integer from ${min} to ${max}`);
    process.exit(2);
  }
  return parsed;
}

const device = new Device(options.serial);
const iterations = numberOption('iterations', options.iterations, 1, 1000);
const settleMs = numberOption('settle', options.settle, 0, 60_000);
const bootSettleMs = numberOption('boot-settle', options['boot-settle'], 0, 60_000);
const port = numberOption('port', options.port, 1024, 65_535);
const selected = options.scenarios.split(',').filter(Boolean);
for (const id of selected)
  if (!SCENARIOS[id]) throw new Error(`Unknown scenario ${id}`);
const targets = JSON.parse(
  await readFile(options.targets, 'utf8').catch(() => '{}')
) as Targets;

const samples: Sample[] = [];
const failures: { scenario: string; iteration: number; error: string }[] = [];

/** One fresh process: cold start, then each selected scenario. */
async function iteration(index: number) {
  const { session, launched, boot } = await launchFresh(device, port);
  try {
    if (selected.includes('cold-start')) {
      samples.push(
        sampleFrom(session, 'cold-start', 'cold', index, launched, boot, [])
      );
      samples.push({
        ...sampleFrom(session, 'cold-start.boot-span', 'cold', index, launched, boot, []),
        // The boot span alone, from navigation start: what the field reports.
        readyMs: boot.end - boot.start,
      });
    }
    await sleep(bootSettleMs);
    for (const id of selected) {
      const scenario = SCENARIOS[id];
      if (!scenario.steps) continue;
      await prepare(session, scenario, targets, settleMs * 2);
      for (const variant of ['cold', 'warm'] as const) {
        for (const step of scenario.steps) {
          try {
            const sample = await measureStep(session, step, targets, variant, index);
            samples.push({ ...sample, hostLoad: loadavg()[0] });
            console.log(
              `  ${index} ${variant.padEnd(4)} ${step.id.padEnd(22)} ${Math.round(sample.readyMs)} ms`
            );
          } catch (error) {
            failures.push({
              scenario: step.id,
              iteration: index,
              error: (error as Error).message,
            });
            console.warn(`  ${index} ${variant} ${step.id}: ${(error as Error).message}`);
          }
          await sleep(settleMs);
        }
      }
    }
  } finally {
    await session.detach();
  }
}

async function environment() {
  const properties = await device.properties();
  const avd = options.serial?.startsWith('emulator-')
    ? (await device.adb('emu', 'avd', 'name').catch(() => '')).split('\n')[0].trim()
    : undefined;
  let avdConfig: Record<string, string> | undefined;
  if (avd) {
    const config = await readFile(
      join(homedir(), '.android/avd', `${avd}.avd`, 'config.ini'),
      'utf8'
    ).catch(() => '');
    avdConfig = Object.fromEntries(
      config
        .split('\n')
        .map((line) => line.split('='))
        .filter(([key]) =>
          ['hw.cpu.ncore', 'hw.ramSize', 'hw.gpu.mode', 'hw.gpu.enabled', 'hw.lcd.width', 'hw.lcd.height', 'hw.lcd.density', 'image.sysdir.1'].includes(key)
        )
    );
  }
  return {
    serial: options.serial,
    properties,
    avd,
    avdConfig,
    app: await device.packageVersion(),
    webview: await device.webviewVersion(),
  };
}

function table(results: Sample[]) {
  const groups = new Map<string, Sample[]>();
  for (const sample of results) {
    const key = `${sample.scenario}\u0000${sample.variant}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return [...groups.entries()].map(([key, group]) => {
    const [scenario, variant] = key.split('\u0000');
    const ready = summarize(group.map((sample) => sample.readyMs));
    const spans = group
      .map((sample) => sample.spanMs)
      .filter((value): value is number => value !== undefined);
    const median = (values: number[]) => summarize(values).median;
    return {
      scenario,
      variant,
      ...ready,
      spanMedian: spans.length ? summarize(spans).median : undefined,
      httpMedian: median(group.map((sample) => sample.requests.http)),
      graphqlMedian: median(group.map((sample) => sample.requests.graphql)),
      warmPhaseShare: median(
        group.map((sample) =>
          sample.phases && sample.phases.count > 0
            ? sample.phases.ready / sample.phases.count
            : Number.NaN
        ).filter((value) => !Number.isNaN(value))
      ),
    };
  });
}

function print(rows: ReturnType<typeof table>) {
  const fmt = (value: number | undefined) =>
    value === undefined || Number.isNaN(value) ? '-' : String(Math.round(value));
  const header = ['scenario', 'variant', 'n', 'median', 'p90', 'min', 'max', 'sd~', 'detect', 'span p50', 'http', 'gql'];
  const lines = rows.map((row) => [
    row.scenario,
    row.variant,
    String(row.n),
    fmt(row.median),
    fmt(row.p90),
    fmt(row.min),
    fmt(row.max),
    fmt(row.robustSd),
    fmt(row.detectableChange),
    fmt(row.spanMedian),
    fmt(row.httpMedian),
    fmt(row.graphqlMedian),
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...lines.map((line) => line[column].length))
  );
  const render = (line: string[]) =>
    line.map((cell, column) => (column < 2 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ');
  console.log(render(header));
  for (const line of lines) console.log(render(line));
  console.log('Times in ms. sd~ is the MAD-based spread; detect is the smallest change between two runs this spread lets the harness detect.');
}

const started = new Date();
const meta = { started: started.toISOString(), label: options.label, iterations, settleMs, bootSettleMs, scenarios: selected, environment: await environment() };
console.log(`Benchmarking ${meta.environment.app} on ${options.serial}, ${iterations} iterations`);
for (let index = 0; index < iterations; index++) {
  console.log(`iteration ${index + 1}/${iterations}`);
  await iteration(index).catch((error: Error) => {
    failures.push({ scenario: 'iteration', iteration: index, error: error.message });
    console.warn(`  iteration ${index} failed: ${error.message}`);
  });
}

const summary = table(samples);
const outDir = resolve(options.out);
await mkdir(outDir, { recursive: true });
const file = join(outDir, `android-benchmark-${started.toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(file, `${JSON.stringify({ meta, summary, failures, samples }, null, 2)}\n`);
print(summary);
if (failures.length) console.warn(`${failures.length} failed steps; see ${file}`);
console.log(`Results: ${file}`);
// A run that measured nothing (signed out, wrong build) is a failure.
process.exit(samples.length > 0 ? 0 : 1);

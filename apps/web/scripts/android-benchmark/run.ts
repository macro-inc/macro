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
import {
  launchFresh,
  measureStep,
  prepare,
  sleep,
  waitForBootFlow,
} from './harness';
import { type Sample, sampleFrom } from './measure';
import { SCENARIOS } from './scenarios';
import { summarize } from './stats';
import {
  candidates,
  fingerprint,
  NoCandidateError,
  parseTargets,
} from './targets';
import { parseCpuThrottle } from './throttle';

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
    'cpu-throttle': { type: 'string', default: '1' },
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
let cpuThrottles: number[];
try {
  cpuThrottles = parseCpuThrottle(options['cpu-throttle']);
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}
const selected = options.scenarios.split(',').filter(Boolean);
for (const id of selected)
  if (!SCENARIOS[id]) throw new Error(`Unknown scenario ${id}`);
// Without a file, scenarios that open items stop the run when they prepare.
const targetsText = await readFile(options.targets, 'utf8').catch(() => '{}');
let targetsFile: ReturnType<typeof parseTargets>;
try {
  targetsFile = parseTargets(targetsText, options.targets);
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}

const samples: Sample[] = [];
const failures: {
  scenario: string;
  iteration: number;
  cpuThrottle: number;
  error: string;
}[] = [];
/** How long each launch's boot `view.app` flow ran, from the launch. */
const boots: { iteration: number; cpuThrottle: number; viewAppMs: number }[] = [];

/** A scenario that could not prepare before it ever ran: the setup is wrong. */
class StopRun extends Error {}

/**
 * One fresh process: cold start, then each selected scenario with the WebView
 * throttled to `cpuThrottle`. DevTools attaches only once the WebView is up,
 * so the cold start always runs unthrottled.
 */
async function iteration(index: number, cpuThrottle: number) {
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
    await session.throttleCpu(cpuThrottle);
    const bootFlow = await waitForBootFlow(session, launched);
    boots.push({ iteration: index, cpuThrottle, viewAppMs: bootFlow.end - launched });
    await sleep(bootSettleMs);
    for (const id of selected) {
      const scenario = SCENARIOS[id];
      if (!scenario.steps) continue;
      let prepared: Awaited<ReturnType<typeof prepare>>;
      try {
        prepared = await prepare(session, scenario, targetsFile, settleMs * 2);
      } catch (error) {
        const message = (error as Error).message;
        failures.push({ scenario: `${id}.prepare`, iteration: index, cpuThrottle, error: message });
        const ids = new Set(scenario.steps.map((step) => step.id));
        // Not once measured: every iteration would fail the same way. Every
        // candidate showing unread is a moment, not a setup error: skip it.
        const transient = error instanceof NoCandidateError && error.onlyUnread;
        if (!transient && !samples.some((sample) => ids.has(sample.scenario)))
          throw new StopRun(`${id} could not prepare: ${message}`);
        console.warn(`  ${index} ${cpuThrottle}× ${id} could not prepare, skipped: ${message}`);
        continue;
      }
      const { targets, choices } = prepared;
      for (const variant of ['cold', 'warm'] as const) {
        for (const step of scenario.steps) {
          try {
            const sample = await measureStep(session, step, targets, variant, index);
            const target = choices.find((choice) => choice.key === (step.opens ?? step.leaves));
            samples.push({ ...sample, target, hostLoad: loadavg()[0] });
            console.log(
              `  ${index} ${cpuThrottle}× ${variant.padEnd(4)} ${step.id.padEnd(22)} ${Math.round(sample.readyMs)} ms`
            );
          } catch (error) {
            failures.push({
              scenario: step.id,
              iteration: index,
              cpuThrottle,
              error: (error as Error).message,
            });
            console.warn(`  ${index} ${cpuThrottle}× ${variant} ${step.id}: ${(error as Error).message}`);
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
  // Samples of different targets are different measurements: separate rows.
  for (const sample of results) {
    const key = `${sample.cpuThrottle}\u0000${sample.scenario}\u0000${sample.variant}\u0000${sample.target?.index ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return [...groups.entries()].map(([key, group]) => {
    const [cpuThrottle, scenario, variant] = key.split('\u0000');
    const target = group[0].target;
    const ready = summarize(group.map((sample) => sample.readyMs));
    const spans = group
      .map((sample) => sample.spanMs)
      .filter((value): value is number => value !== undefined);
    const median = (values: number[]) => summarize(values).median;
    return {
      cpuThrottle: Number(cpuThrottle),
      scenario,
      variant,
      target: target && { index: target.index, fingerprint: target.fingerprint },
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
      measuredThrottleMedian: median(
        group.flatMap((sample) => sample.cpuThrottleMeasured ?? [])
      ),
    };
  });
}

function print(rows: ReturnType<typeof table>) {
  const fmt = (value: number | undefined) =>
    value === undefined || Number.isNaN(value) ? '-' : String(Math.round(value));
  const header = ['scenario', 'variant', 'target', 'n', 'median', 'p90', 'min', 'max', 'sd~', 'detect', 'span p50', 'http', 'gql', 'cpu'];
  const lines = rows.map((row) => [
    row.scenario,
    row.variant,
    row.target ? String(row.target.index) : '-',
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
    Number.isNaN(row.measuredThrottleMedian) ? '-' : `${row.measuredThrottleMedian.toFixed(1)}×`,
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...lines.map((line) => line[column].length))
  );
  const render = (line: string[]) =>
    line.map((cell, column) => (column < 2 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ');
  for (const rate of [...new Set(rows.map((row) => row.cpuThrottle))].sort((a, b) => a - b)) {
    console.log(`\nCPU throttle ${rate}×${rate === 1 ? ' (none)' : ' (WebView renderer only)'}`);
    console.log(render(header));
    rows.forEach((row, index) => {
      if (row.cpuThrottle === rate) console.log(render(lines[index]));
    });
  }
  if (selected.includes('cold-start'))
    console.log('Cold start is never throttled, so its rows are under 1×.');
  console.log('target is the candidate a step opened, by its position in the targets file.');
  console.log('cpu is the WebView slowdown measured around each step.');
  const targetRows = new Map<string, number>();
  for (const row of rows.filter((entry) => entry.target)) {
    const step = `${row.scenario} ${row.variant} at ${row.cpuThrottle}×`;
    targetRows.set(step, (targetRows.get(step) ?? 0) + 1);
  }
  for (const [step, count] of targetRows)
    if (count > 1)
      console.warn(`Warning: ${step} opened ${count} different targets in this run; compare its rows only with rows of the same target.`);
  console.log('Times in ms. sd~ is the MAD-based spread; detect is the smallest change between two runs this spread lets the harness detect.');
}

const started = new Date();
// Targets by position and id hash only: results never name account content.
const targetSummary = Object.fromEntries(
  (['channel', 'smallDocument', 'largeDocument'] as const).map((key) => [
    key,
    candidates(targetsFile, key).map((item) => fingerprint(item.id)),
  ])
);
const meta = { started: started.toISOString(), label: options.label, iterations, cpuThrottle: cpuThrottles, settleMs, bootSettleMs, scenarios: selected, targets: targetSummary, environment: await environment() };
const profiles = cpuThrottles.map((rate) => `${rate}×`).join(', ');
console.log(
  `Benchmarking ${meta.environment.app} on ${options.serial}, ${iterations} iterations at CPU throttle ${profiles}` +
    (cpuThrottles.length > 1 ? `: ${iterations * cpuThrottles.length} launches, alternating` : '')
);
let stopped: string | undefined;
for (let index = 0; index < iterations && !stopped; index++) {
  // Alternating profiles within each iteration exposes them to the same host load.
  for (const cpuThrottle of cpuThrottles) {
    console.log(`iteration ${index + 1}/${iterations}, CPU throttle ${cpuThrottle}×`);
    try {
      await iteration(index, cpuThrottle);
    } catch (error) {
      if (error instanceof StopRun) {
        stopped = error.message;
        console.error(`Stopping the run: ${stopped}`);
        break;
      }
      failures.push({ scenario: 'iteration', iteration: index, cpuThrottle, error: (error as Error).message });
      console.warn(`  iteration ${index} at ${cpuThrottle}× failed: ${(error as Error).message}`);
    }
  }
}

const summary = table(samples);
const outDir = resolve(options.out);
await mkdir(outDir, { recursive: true });
const profileName = [...cpuThrottles].sort((a, b) => a - b).map((rate) => `${rate}x`).join('-');
const file = join(outDir, `android-benchmark-${started.toISOString().replace(/[:.]/g, '-')}-cpu${profileName}.json`);
await writeFile(file, `${JSON.stringify({ meta: { ...meta, stopped }, summary, failures, boots, samples }, null, 2)}\n`);
print(summary);
const bootFlows = summarize(boots.map((boot) => boot.viewAppMs));
if (boots.length)
  console.log(`Boot view.app flow ended ${Math.round(bootFlows.median)} ms after launch (median; max ${Math.round(bootFlows.max)}); the first tap waits for it.`);
if (failures.length) console.warn(`${failures.length} failed steps; see ${file}`);
console.log(`Results: ${file}`);
// A run that measured nothing (signed out, wrong build), or nothing at one of
// its rates (the throttle never took), is a failure.
const timedSteps = selected.some((id) => SCENARIOS[id].steps);
// Only timed steps count: cold start always runs at 1×, whatever the rate.
const unmeasured = cpuThrottles.filter(
  (rate) =>
    !samples.some(
      (sample) => sample.cpuThrottle === rate && sample.cpuThrottleMeasured
    )
);
if (timedSteps && unmeasured.length)
  console.warn(`No steps measured at CPU throttle ${unmeasured.map((rate) => `${rate}×`).join(', ')}`);
if (stopped) console.error(`The run stopped early: ${stopped}`);
process.exit(samples.length > 0 && !stopped && !(timedSteps && unmeasured.length) ? 0 : 1);

/**
 * Runs the cache engine benchmark (`bench.html`) in a real browser on OPFS.
 *
 * Usage, from apps/web. Build the bench page first:
 *   just build-cache-wasm
 *   bunx --bun vite build --config src/lib/graphql-cache/worker/browser-test/bench.vite.config.ts
 *   bun scripts/cache-wasm/cli.ts package-dist --dist src/lib/graphql-cache/worker/browser-test/.dist-bench
 * then run:
 *   node src/lib/graphql-cache/worker/browser-test/bench-runner.ts \
 *     --data <dir with seed.ndjson, foreground.ndjson, meta.json> \
 *     [--profile <browser profile dir>] [--reseed] [--runs 5] [--out results.json]
 *
 * The dataset comes from `cargo run -p cache-bench -- generate`. A browser
 * profile keeps the seeded OPFS database between invocations, so cold-open
 * and read measurements can be repeated without reseeding.
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright';

const { values: args } = parseArgs({
  options: {
    data: { type: 'string' },
    profile: { type: 'string' },
    reseed: { type: 'boolean', default: false },
    runs: { type: 'string', default: '5' },
    out: { type: 'string' },
    port: { type: 'string', default: '4189' },
    headed: { type: 'boolean', default: false },
    'skip-contended': { type: 'boolean', default: false },
  },
});
if (!args.data) throw new Error('--data is required');
const dataDir = resolve(args.data);
const profileDir = resolve(args.profile ?? `${dataDir}/profile`);
const runs = Number(args.runs);
const port = Number(args.port);
const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '../../../../../');
const dist = resolve(here, '.dist-bench');
const origin = `http://127.0.0.1:${port}`;
const SCOPE = 'cache-bench';
// Marks a profile directory this runner created, so a reseed only ever deletes
// one of those.
const OWNED = '.bench-profile';

function lines(path: string): Buffer[] {
  const buffer = readFileSync(path);
  const out: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index++) {
    if (buffer[index] === 10) {
      if (index > start) out.push(buffer.subarray(start, index));
      start = index + 1;
    }
  }
  if (start < buffer.length) out.push(buffer.subarray(start));
  return out;
}

const seedOps = lines(`${dataDir}/seed.ndjson`);
const foregroundOps = lines(`${dataDir}/foreground.ndjson`);
const meta = JSON.parse(readFileSync(`${dataDir}/meta.json`, 'utf8')) as {
  tier: string;
  threadIds: string[];
};
const homeVariables = JSON.parse(String(foregroundOps[0])).variables;
// Foreground ops come in variants; each run writes the next one, continuing
// across invocations on one profile, so every write changes rows.
const foregroundVariants = foregroundOps.map(
  (line) => (JSON.parse(String(line)) as { variant?: number }).variant ?? 0
);
const variantCount = Math.max(...foregroundVariants) + 1;
const variantFile = `${profileDir}/.next-variant`;
function variantIndices(variant: number) {
  return foregroundVariants.flatMap((each, index) =>
    each === variant ? [index] : []
  );
}
const threads = meta.threadIds.slice(0, 5);
// Background hydration during the contended pass replays mail pages.
const backgroundBase = '/bench-data/seed';
const backgroundCount = Math.min(seedOps.length, 40);

type Step = { name: string; ms: number };

function quantile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const lowValue = sorted[low] ?? Number.NaN;
  const highValue = sorted[high] ?? Number.NaN;
  return lowValue + (highValue - lowValue) * (position - low);
}

function summarize(samples: Record<string, number[]>) {
  return Object.fromEntries(
    Object.entries(samples).map(([name, values]) => [
      name,
      {
        n: values.length,
        p50: round(quantile(values, 0.5)),
        p90: round(quantile(values, 0.9)),
        max: round(Math.max(...values)),
        total: round(values.reduce((sum, value) => sum + value, 0)),
      },
    ])
  );
}

const round = (value: number) => Math.round(value * 10) / 10;

function append(target: Record<string, number[]>, key: string, value: number) {
  const values = target[key];
  if (values) values.push(value);
  else target[key] = [value];
}

function collect(target: Record<string, number[]>, steps: Step[], prefix = '') {
  for (const { name, ms } of steps) append(target, `${prefix}${name}`, ms);
}

async function startServer(): Promise<() => void> {
  if (!existsSync(dist))
    throw new Error(
      `missing ${dist}; build it with the steps in this file's header`
    );
  const server = spawn(
    process.execPath,
    [
      resolve(webDir, 'scripts/cache-wasm/precompressed-preview-server.mjs'),
      dist,
    ],
    {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'inherit'],
    }
  );
  await new Promise<void>((ready, fail) => {
    server.once('error', fail);
    server.once('exit', (code, signal) =>
      fail(
        new Error(`preview server exited (${code ?? signal}) before listening`)
      )
    );
    server.stdout.on('data', (chunk: Buffer) => {
      if (String(chunk).includes('listening')) ready();
    });
  });
  return () => server.kill();
}

async function openPage(
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>
) {
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      process.stderr.write(`[page ${message.type()}] ${message.text()}\n`);
  });
  page.on('pageerror', (error) =>
    process.stderr.write(`[page error] ${error.stack ?? error}\n`)
  );
  const started = Date.now();
  await page.goto(`${origin}/app/bench.html`);
  await page.waitForFunction(
    () =>
      document.querySelector('#result')?.getAttribute('data-status') === 'ready'
  );
  return { page, loadMs: Date.now() - started };
}

const call = <T>(
  page: Page,
  method: string,
  ...params: unknown[]
): Promise<T> =>
  page.evaluate(
    ([name, rest]) =>
      (
        window as unknown as {
          cacheBench: Record<string, (...a: unknown[]) => unknown>;
        }
      ).cacheBench[name as string]?.(...(rest as unknown[])) as Promise<T>,
    [method, params] as const
  );

// Sizes and modification times of the dataset files: a profile seeded from
// another dataset, or from this directory before it was regenerated, does not
// match.
function datasetFingerprint() {
  return ['seed.ndjson', 'foreground.ndjson', 'meta.json']
    .map((file) => {
      const stat = statSync(`${dataDir}/${file}`);
      return `${file}:${stat.size}:${stat.mtimeMs}`;
    })
    .join(' ');
}

async function main() {
  const fresh = args.reseed || !existsSync(`${profileDir}/.seeded`);
  if (!fresh) {
    // OPFS belongs to the origin, port included: another port opens an empty
    // database while this marker skips the seed.
    const [seededOrigin, seededDataset] = readFileSync(
      `${profileDir}/.seeded`,
      'utf8'
    ).split('\n');
    if (seededOrigin !== origin)
      throw new Error(
        seededOrigin.startsWith('http')
          ? `profile was seeded on ${seededOrigin}; rerun with that --port or --reseed`
          : 'profile predates origin markers; pass a new --profile path'
      );
    if (seededDataset !== datasetFingerprint())
      throw new Error(
        `profile was seeded from another dataset than ${dataDir}; rerun with --reseed`
      );
  }
  if (fresh) {
    rmProfile();
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(`${profileDir}/${OWNED}`, '');
  }
  const stopServer = await startServer();
  let context:
    | Awaited<ReturnType<typeof chromium.launchPersistentContext>>
    | undefined;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: !args.headed,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    });
    await runBench(context, fresh);
  } finally {
    try {
      await context?.close();
    } finally {
      stopServer();
    }
  }
}

async function runBench(
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
  fresh: boolean
) {
  await context.route(`${origin}/bench-data/**`, async (route) => {
    const url = new URL(route.request().url());
    const [, , set, index] = url.pathname.split('/');
    const source = set === 'seed' ? seedOps : foregroundOps;
    const body = source[Number(index)];
    if (!body) return route.fulfill({ status: 404 });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body,
    });
  });

  const result: Record<string, unknown> = {
    tier: meta.tier,
    when: new Date().toISOString(),
    seedOps: seedOps.length,
  };
  if (fresh) {
    const { page } = await openPage(context);
    const opened = await call<unknown>(page, 'open', SCOPE);
    const seedStarted = Date.now();
    const rows = await call<Array<{ lane: string; ms: number; bytes: number }>>(
      page,
      'seed',
      '/bench-data/seed',
      seedOps.length
    );
    const seedWallMs = Date.now() - seedStarted;
    const byLane: Record<string, number[]> = {};
    const bytes: Record<string, number> = {};
    for (const row of rows) {
      append(byLane, row.lane, row.ms);
      bytes[row.lane] = (bytes[row.lane] ?? 0) + row.bytes;
    }
    const storage = await call<{
      usage: number;
      files: Array<{ name: string; bytes: number }>;
    }>(page, 'storage');
    result.seed = {
      opened,
      wallMs: seedWallMs,
      lanes: summarize(byLane),
      payloadBytes: bytes,
      storage,
      telemetry: await call(page, 'telemetry'),
    };
    await call(page, 'close');
    await page.close();
    writeFileSync(
      `${profileDir}/.seeded`,
      `${origin}\n${datasetFingerprint()}\n${new Date().toISOString()}\n`
    );
    log('seed', result.seed);
  }

  const coldOpen: Record<string, number[]> = {};
  const reads: Record<string, number[]> = {};
  const writes: Record<string, number[]> = {};
  const contended: Record<string, number[]> = {};
  const background: number[] = [];
  const lifecycle: unknown[] = [];
  const telemetry: unknown[] = [];
  let counts: unknown;
  for (let run = 0; run < runs; run++) {
    const { page, loadMs } = await openPage(context);
    const opened = await call<{
      totalMs: number;
      firstReadMs: number;
      lifecycle: Array<{ name: string; side: string; durationMs?: number }>;
    }>(page, 'open', SCOPE);
    append(coldOpen, 'page.load', loadMs);
    append(coldOpen, 'open.total', opened.totalMs);
    append(coldOpen, 'open.firstRead', opened.firstReadMs);
    for (const event of opened.lifecycle) {
      if (event.durationMs === undefined) continue;
      append(coldOpen, `${event.side}:${event.name}`, event.durationMs);
    }
    lifecycle.push(opened.lifecycle);
    // Two passes: the first right after open, the second warm.
    for (const pass of ['first', 'warm']) {
      const readResult = await call<{ steps: Step[]; counts: unknown }>(
        page,
        'readPass',
        threads,
        homeVariables
      );
      counts = readResult.counts;
      collect(reads, readResult.steps, `${pass}:`);
    }
    const variant = existsSync(variantFile)
      ? Number(readFileSync(variantFile, 'utf8')) % variantCount
      : 1 % variantCount;
    const writeResult = await call<{ steps: Step[] }>(
      page,
      'writePass',
      '/bench-data/foreground',
      variantIndices(variant)
    );
    collect(writes, writeResult.steps);
    writeFileSync(variantFile, String((variant + 1) % variantCount));
    if (!args['skip-contended']) {
      const contendedResult = await call<{
        steps: Step[];
        background: number[];
      }>(
        page,
        'contended',
        threads,
        homeVariables,
        backgroundBase,
        backgroundCount
      );
      collect(contended, contendedResult.steps);
      background.push(...contendedResult.background);
    }
    telemetry.push(await call(page, 'telemetry'));
    await call(page, 'close');
    await page.close();
    process.stderr.write(`run ${run + 1}/${runs} done\n`);
  }
  result.coldOpen = summarize(coldOpen);
  result.reads = summarize(reads);
  result.writes = summarize(writes);
  result.contended = summarize(contended);
  result.backgroundHydrate = summarize({ hydrate: background });
  result.counts = counts;
  result.lifecycle = lifecycle;
  result.telemetry = telemetry;
  log('coldOpen', result.coldOpen);
  log('reads', result.reads);
  log('writes', result.writes);
  log('contended', result.contended);
  log('backgroundHydrate', result.backgroundHydrate);
  log('counts', counts);
  const out = args.out ?? `${dataDir}/results-${Date.now()}.json`;
  writeFileSync(out, JSON.stringify(result, null, 2));
  process.stderr.write(`wrote ${out}\n`);
}

function rmProfile() {
  if (existsSync(profileDir)) {
    if (!existsSync(`${profileDir}/${OWNED}`))
      throw new Error(`refusing to delete ${profileDir}: not a bench profile`);
    rmSync(profileDir, { recursive: true, force: true });
  }
}

function log(label: string, value: unknown) {
  const text = JSON.stringify(value, null, 1);
  process.stdout.write(
    `\n== ${label}\n${text.length > 4000 ? `${text.slice(0, 4000)}…` : text}\n`
  );
}

await main();

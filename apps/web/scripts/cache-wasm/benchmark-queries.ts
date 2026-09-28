/** Runs the real production browser worker cache against exported GraphQL fixtures. */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, firefox } from '@playwright/test';
import type {
  BenchmarkCorpus,
  BrowserBenchmarkOptions,
} from '../../src/lib/graphql-cache/worker/browser-test/graphql-queries-types';

const { values } = parseArgs({
  options: {
    fixtures: { type: 'string' },
    dist: { type: 'string', default: 'src/lib/graphql-cache/worker/browser-test/.dist-benchmark' },
    output: { type: 'string' },
    browser: { type: 'string', default: 'chromium' },
    'executable-path': { type: 'string' },
    samples: { type: 'string', default: '30' },
    warmup: { type: 'string', default: '5' },
    'cold-samples': { type: 'string', default: '3' },
    sizes: { type: 'string' },
    variants: { type: 'string' },
    'cache-records': { type: 'string' },
    scenarios: { type: 'string', default: '' },
    filter: { type: 'string', default: '' },
    headed: { type: 'boolean', default: false },
  },
  strict: true,
});
if (!values.fixtures || !values.output) throw new Error('--fixtures and --output are required');
if (values.browser !== 'chromium' && values.browser !== 'firefox') throw new Error('browser must be chromium or firefox');
const fixtureDirectory = resolve(values.fixtures);
const distDirectory = resolve(values.dist);
const manifest: BenchmarkCorpus = JSON.parse(await readFile(resolve(fixtureDirectory, 'manifest.json'), 'utf8'));
function integer(value: string, minimum: number): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error(`invalid integer: ${value}`);
  return number;
}
const options: BrowserBenchmarkOptions = {
  samples: integer(values.samples, 1), warmup: integer(values.warmup, 0),
  cold_samples: integer(values['cold-samples'], 0),
  sizes: values.sizes?.split(',').map((value) => integer(value, 1)) ?? manifest.sizes,
  variants: values.variants?.split(',').map((value) => integer(value, 1)) ?? manifest.variants,
  cache_records: values['cache-records']?.split(',').map((value) => integer(value, 1)) ?? manifest.cache_records ?? [],
  filter: values.filter, scenarios: values.scenarios.split(',').filter(Boolean),
};
if (options.sizes.some((size) => !manifest.sizes.includes(size))) throw new Error('requested size was not exported');
if (options.variants.some((count) => count > Math.max(...manifest.variants))) throw new Error('requested variants were not exported');
if (options.cache_records.some((count) => !manifest.cache_records?.includes(count))) throw new Error('requested cache population was not exported');
const operations = manifest.inventory.filter((operation) => operation.name.includes(options.filter));
if (operations.length === 0) throw new Error('filter matched no operations');
const hash = createHash('sha256');
for (const file of (await readdir(fixtureDirectory)).filter((file) => file.endsWith('.json')).sort()) {
  hash.update(file);
  hash.update(await readFile(resolve(fixtureDirectory, file)));
}
const bundleHash = createHash('sha256');
for (const file of (await readdir(resolve(distDirectory, 'assets'))).sort()) {
  bundleHash.update(file);
  bundleHash.update(await readFile(resolve(distDirectory, 'assets', file)));
}
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const fixture = path.startsWith('/fixtures/');
    const directory = fixture ? fixtureDirectory : distDirectory;
    const suffix = decodeURIComponent(path.slice(fixture ? '/fixtures/'.length : '/app/'.length));
    const filePath = resolve(directory, suffix);
    if ((!fixture && !path.startsWith('/app/')) || !filePath.startsWith(`${directory}${sep}`)) return new Response('Not found', { status: 404 });
    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response('Not found', { status: 404 });
    return new Response(file);
  },
});
const browserType = values.browser === 'firefox' ? firefox : chromium;
try {
  const browser = await browserType.launch({
    executablePath: values['executable-path'], headless: !values.headed,
    // Benchmark-only preference: prevent millisecond rounding from producing
    // zero-duration samples. The production worker and storage are unchanged.
    firefoxUserPrefs: { 'privacy.reduceTimerPrecision': false },
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    const wasmRequests = new Set<string>();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.text().startsWith('BENCH ')) console.log(message.text());
    });
    context.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('.wasm')) wasmRequests.add(request.url());
    });
    await page.goto(`${server.url}app/graphql-queries.html`);
    await page.waitForFunction(() => typeof window.runGraphqlCacheBenchmark === 'function');
    const result = await page.evaluate(async ({ manifest, options }) => window.runGraphqlCacheBenchmark(manifest, options), { manifest, options });
    if (errors.length) throw new Error(errors.join('\n'));
    const covered = new Set(result.rows.map((row) => row.operation));
    for (const operation of operations) {
      if (!covered.has(operation.name)) throw new Error(`missing measurements for ${operation.name}`);
    }
    if (wasmRequests.size !== 1) throw new Error(`expected one production WASM artifact, saw ${wasmRequests.size}`);
    const wasmUrl = [...wasmRequests][0];
    const wasmBytes = await (await fetch(wasmUrl)).arrayBuffer();
    const report = {
      host: 'browser-worker-turso', disk: true,
      architecture: `${process.arch}-${process.platform}-${values.browser}`,
      browser_version: browser.version(), reduced_timer_precision: values.browser !== 'firefox', schema_hash: manifest.schema_hash,
      corpus_hash: hash.digest('hex'), bundle_sha256: bundleHash.digest('hex'), wasm_sha256: createHash('sha256').update(new Uint8Array(wasmBytes)).digest('hex'),
      options, inventory: manifest.inventory.map((operation) => [operation.name, operation.source]),
      ...result,
    };
    await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${result.rows.length} scenarios to ${values.output}`);
  } finally {
    await browser.close();
  }
} finally {
  await server.stop(true);
}

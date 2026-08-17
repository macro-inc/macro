import { expect, type Page, test } from '@playwright/test';
import { CACHE_WASM_BUDGETS } from '../../../../../scripts/cache-wasm/budgets';
import type { CacheWasmPerformanceSample } from './performance-harness';

type CacheWasmBrowserSample = CacheWasmPerformanceSample & {
  browser: 'chromium' | 'firefox';
  wasmUrl: string;
};

const percentile95 = (values: number[]): number =>
  [...values].sort((left, right) => left - right)[
    Math.ceil(values.length * 0.95) - 1
  ]!;

const SAMPLE_COUNT = 5;
const isProductionProject = (projectName: string): boolean =>
  projectName.includes('production');
const harnessPath = (projectName: string, page: string): string =>
  isProductionProject(projectName) ? `/app/${page}` : `/${page}`;

async function fetchedWasmEvidence(
  page: Page,
  wasmUrl: string
): Promise<{
  contentType: string | null;
  contentEncoding: string | null;
  validModule: boolean;
  sha256: string;
}> {
  return await page.evaluate(async (url) => {
    const response = await fetch(url);
    const bytes = await response.arrayBuffer();
    const [module, digest] = await Promise.all([
      WebAssembly.compile(bytes),
      crypto.subtle.digest('SHA-256', bytes),
    ]);
    return {
      contentType: response.headers.get('content-type'),
      contentEncoding: response.headers.get('content-encoding'),
      validModule: module instanceof WebAssembly.Module,
      sha256: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    };
  }, wasmUrl);
}

test('exact production CacheHost reaches the exact engine URL without a wrapper', async ({
  context,
  page,
}, testInfo) => {
  const requests: string[] = [];
  const wasmResponses: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  context.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('.wasm')) {
      wasmResponses.push(response.url());
    }
  });

  await page.goto(
    harnessPath(testInfo.project.name, 'exact-production-host.html')
  );
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', 'passed', {
    timeout: 30_000,
  });
  const report = JSON.parse((await result.textContent()) ?? '') as {
    sharedWorkerConstructions: number;
    dedicatedWorkerConstructions: number;
    engineWorkerUrl: string;
    crossOriginIsolated: boolean;
    sharedArrayBufferAvailable: boolean;
  };
  expect(report).toMatchObject({
    sharedWorkerConstructions: 1,
    dedicatedWorkerConstructions: 1,
    crossOriginIsolated: false,
    sharedArrayBufferAvailable: false,
  });
  expect(report.engineWorkerUrl).toContain('cache.engine-worker');
  expect(report.engineWorkerUrl).not.toContain('instrumented-cache');
  expect(
    requests.filter((url) => url.includes('instrumented-cache.engine-worker'))
  ).toEqual([]);
  expect(
    requests.filter((url) => url.includes('cache.engine-worker'))
  ).toHaveLength(1);
  expect(wasmResponses).toHaveLength(1);
  const served = await fetchedWasmEvidence(page, wasmResponses[0]);
  expect(served).toEqual({
    contentType: expect.stringContaining('application/wasm'),
    contentEncoding: isProductionProject(testInfo.project.name) ? 'br' : null,
    validModule: true,
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
});

test('combined cache WASM stays lazy and meets fresh-scope startup budgets', async ({
  context,
  page,
}, testInfo) => {
  const requests: string[] = [];
  const wasmResponses: string[] = [];
  const browserName = testInfo.project.name.includes('firefox')
    ? 'firefox'
    : 'chromium';
  context.on('request', (request) => requests.push(request.url()));
  context.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('.wasm')) {
      wasmResponses.push(response.url());
    }
  });

  await page.goto(harnessPath(testInfo.project.name, 'performance.html'));
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'idle');
  await page.waitForTimeout(250);
  expect(
    requests.filter((url) => {
      const parsed = new URL(url);
      if (parsed.pathname.includes('cache_wasm')) return true;
      const enginePath =
        /(?:cache[.-]engine-worker|instrumented-cache\.engine-worker)/.test(
          parsed.pathname
        );
      // Vite dev loads a tiny `?worker&url` URL-export module eagerly; it does
      // not fetch or execute the worker script (`?worker_file`) or WASM.
      return (
        enginePath &&
        (!parsed.searchParams.has('worker') ||
          parsed.searchParams.has('worker_file'))
      );
    })
  ).toEqual([]);

  const samples: CacheWasmBrowserSample[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    const responseCountBefore = wasmResponses.length;
    let measurement: CacheWasmPerformanceSample;
    try {
      measurement = await page.evaluate(async () => {
        const run = (
          window as typeof window & {
            runCacheWasmPerformanceSample(): Promise<CacheWasmPerformanceSample>;
          }
        ).runCacheWasmPerformanceSample;
        return await run();
      });
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nrequests:\n${requests.join('\n')}`
      );
    }
    const sampleWasmResponses = wasmResponses.slice(responseCountBefore);
    expect(sampleWasmResponses).toHaveLength(1);
    expect(measurement.wasmFetchCount).toBe(sampleWasmResponses.length);
    expect(measurement.wasmSha256).toMatch(/^[a-f0-9]{64}$/);
    samples.push({
      ...measurement,
      browser: browserName,
      wasmUrl: sampleWasmResponses[0],
    });
  }

  const mode = samples[0].mode;
  const production = mode === 'production';
  expect(production).toBe(isProductionProject(testInfo.project.name));
  expect(samples).toHaveLength(SAMPLE_COUNT);
  for (const sample of samples) {
    expect(sample).toMatchObject({
      mode,
      sharedWorkerConstructions: 1,
      dedicatedWorkerConstructions: 1,
      nestedWorkerConstructions: 0,
      ownerEpochs: [1],
      crossOriginIsolated: false,
      sharedArrayBufferAvailable: false,
    });
    expect(sample.linearMemoryBytes).toBeLessThanOrEqual(
      CACHE_WASM_BUDGETS.linearMemoryBytes
    );
    expect(sample.productionEngineUrl).not.toBe(sample.instrumentedEngineUrl);
  }

  const sharedWorkerUrls = [
    ...new Set(samples.map((sample) => sample.sharedWorkerUrl)),
  ];
  const productionEngineUrls = [
    ...new Set(samples.map((sample) => sample.productionEngineUrl)),
  ];
  const instrumentedEngineUrls = [
    ...new Set(samples.map((sample) => sample.instrumentedEngineUrl)),
  ];
  const wasmUrls = [...new Set(samples.map((sample) => sample.wasmUrl))];
  expect(sharedWorkerUrls).toHaveLength(1);
  expect(productionEngineUrls).toHaveLength(1);
  expect(instrumentedEngineUrls).toHaveLength(1);
  expect(wasmUrls).toHaveLength(1);
  if (mode === 'development') {
    expect(sharedWorkerUrls[0]).toContain(
      '/src/lib/graphql-cache/worker/cache.coordinator.shared-worker.ts'
    );
    expect(productionEngineUrls[0]).toContain(
      '/src/lib/graphql-cache/worker/cache.engine-worker.ts'
    );
    expect(instrumentedEngineUrls[0]).toContain(
      '/instrumented-cache.engine-worker.ts'
    );
  } else {
    expect(sharedWorkerUrls[0]).toMatch(
      /\/app\/assets\/cache\.coordinator\.shared-worker-[\w-]+\.js$/
    );
    expect(productionEngineUrls[0]).toMatch(
      /\/app\/assets\/cache\.engine-worker-[\w-]+\.js$/
    );
    expect(instrumentedEngineUrls[0]).toMatch(
      /\/app\/assets\/instrumented-cache\.engine-worker-[\w-]+\.js$/
    );
    expect(wasmUrls[0]).toMatch(/\/app\/assets\/cache_wasm_bg-[\w-]+\.wasm$/);
  }

  const browserReadyP95Ms = percentile95(
    samples.map((sample) => sample.browserReadyMs)
  );
  const hostFirstReadyP95Ms = percentile95(
    samples.map((sample) => sample.hostFirstReadyMs)
  );
  expect(browserReadyP95Ms).toBeLessThanOrEqual(
    CACHE_WASM_BUDGETS.browserReadyP95Ms
  );
  expect(hostFirstReadyP95Ms).toBeLessThanOrEqual(
    CACHE_WASM_BUDGETS.hostFirstReadyP95Ms
  );
  // The instrumented engine clones and hashes each actual decoded runtime
  // response, so artifact binding adds no second WASM request.
  expect(wasmResponses).toHaveLength(SAMPLE_COUNT);
  const wasmHashes = [...new Set(samples.map((sample) => sample.wasmSha256))];
  expect(wasmHashes).toHaveLength(1);

  if (production) {
    for (const workerUrl of [
      sharedWorkerUrls[0],
      productionEngineUrls[0],
      instrumentedEngineUrls[0],
    ]) {
      const evidence = await page.evaluate(async (mapUrl) => {
        const response = await fetch(mapUrl);
        const value = (await response.json()) as { sources?: unknown };
        return {
          ok: response.ok,
          contentType: response.headers.get('content-type'),
          hasSources: Array.isArray(value.sources) && value.sources.length > 0,
        };
      }, `${workerUrl}.map`);
      expect(evidence).toEqual({
        ok: true,
        contentType: expect.stringContaining('application/json'),
        hasSources: true,
      });
    }
  }
});

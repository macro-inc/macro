import type { CacheHost, CacheReadArgs } from '../../host/types';
import { createWorkerCacheHost } from '../../host/worker-host';
import type { ReadResult, SelectedRecordByKeyWire } from '../../protocol';
import { MAX_RECORD_SELECTION_PAGE_SIZE } from '../../protocol';
import {
  databaseOwnerLockName,
  tabLivenessLockName,
} from '../coordinator-protocol';
import type {
  BenchmarkCorpus,
  BenchmarkFixture,
  BenchmarkOperation,
  BrowserBenchmarkOptions,
  BrowserBenchmarkResult,
  BrowserBenchmarkRow,
} from './graphql-queries-types';

function assertHit(result: ReadResult): unknown {
  if (result.kind !== 'hit') throw new Error('expected a cache hit');
  return result.data;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item))
      return item;
    return Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
    );
  });
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  description: string
): void {
  const actualJson = canonical(actual);
  const expectedJson = canonical(expected);
  if (actualJson === expectedJson) return;
  let index = 0;
  while (actualJson[index] === expectedJson[index]) index++;
  throw new Error(
    `${description}: round trip differs at character ${index}: actual ${actualJson.slice(Math.max(0, index - 70), index + 160)}; expected ${expectedJson.slice(Math.max(0, index - 70), index + 160)}`
  );
}

async function loadFixture(file: string): Promise<BenchmarkFixture> {
  const response = await fetch(`/fixtures/${file}`);
  if (!response.ok) throw new Error(`fixture ${file}: HTTP ${response.status}`);
  return response.json();
}

function createHost(scope: string, hotCapacity?: number): CacheHost {
  const host = createWorkerCacheHost({
    scope,
    hotCapacity,
    requestTimeoutMs: 30_000,
  });
  if (host.disabled)
    throw new Error('browser cache fell back to the no-op host');
  return host;
}

async function closeHost(scope: string, host: CacheHost): Promise<void> {
  const livenessPrefix = tabLivenessLockName(scope, '');
  const snapshot = await navigator.locks.query();
  const locks =
    snapshot.held?.flatMap((lock) =>
      lock.name?.startsWith(livenessPrefix) ? [lock.name] : []
    ) ?? [];
  host.dispose();
  // Wait for storage and the retired clients. Reopening after only storage
  // release can race the coordinator's asynchronous departure processing.
  await Promise.all(
    [databaseOwnerLockName(scope), ...locks].map((name) =>
      navigator.locks.request(
        name,
        { signal: AbortSignal.timeout(30_000) },
        () => {}
      )
    )
  );
}

class Measurements {
  readonly rows: BrowserBenchmarkRow[] = [];
  population?: { cache_records: number; hot_capacity: number };
  requestsPerRead = 1;
  constructor(readonly options: BrowserBenchmarkOptions) {}

  includes(scenario: string): boolean {
    return (
      this.options.scenarios.length === 0 ||
      this.options.scenarios.includes(scenario)
    );
  }

  async measure(
    operation: string,
    size: number,
    records: number,
    scenario: string,
    run: () => Promise<unknown>,
    setup?: () => Promise<void>
  ): Promise<void> {
    if (!this.includes(scenario)) return;
    const cold = scenario === 'reopen-first-read';
    const samples = cold ? this.options.cold_samples : this.options.samples;
    if (samples === 0) return;
    const warmup = cold ? 0 : this.options.warmup;
    const times: number[] = [];
    for (let index = 0; index < warmup + samples; index++) {
      await setup?.();
      const started = performance.now();
      await run();
      const elapsed = (performance.now() - started) * 1000;
      if (index >= warmup) times.push(elapsed);
    }
    times.sort((a, b) => a - b);
    const row: BrowserBenchmarkRow = {
      operation,
      size,
      scenario,
      normalized_records: records,
      ...this.population,
      requests_per_read:
        scenario === 'unchanged-write'
          ? 1
          : this.requestsPerRead * (scenario === 'concurrent-8-total' ? 8 : 1),
      samples,
      min_us: times[0],
      p50_us: times[Math.ceil(times.length * 0.5) - 1],
      p95_us: times[Math.ceil(times.length * 0.95) - 1],
      max_us: times[times.length - 1],
      mean_us: times.reduce((sum, value) => sum + value, 0) / times.length,
      samples_us: times,
    };
    this.rows.push(row);
    console.info(
      `BENCH ${operation} ${size} ${scenario}: ${row.p50_us.toFixed(1)} us`
    );
    const element = document.querySelector('#result');
    if (element) element.textContent = JSON.stringify(row, null, 2);
  }
}

async function runCase(
  corpus: BenchmarkCorpus,
  operation: BenchmarkOperation,
  size: number,
  files: string[],
  measurements: Measurements,
  cacheRecords?: number
): Promise<void> {
  const fixture = await loadFixture(files[0]);
  const scope = `gql-benchmark-${crypto.randomUUID()}`;
  let host = createHost(scope);
  const readArgs: CacheReadArgs = {
    query: operation.document,
    operationName: operation.name,
    variables: fixture.variables,
  };
  const fragmentArgs = {
    document: operation.document,
    fragmentName: operation.name,
    keys: fixture.expected?.map((item) => item.recordKey) ?? [],
  };
  measurements.requestsPerRead =
    operation.kind === 'fragment'
      ? Math.ceil(size / MAX_RECORD_SELECTION_PAGE_SIZE)
      : 1;
  const readFragments = async (
    target: CacheHost,
    document = operation.document
  ) => {
    const records: SelectedRecordByKeyWire[] = [];
    for (
      let offset = 0;
      offset < fragmentArgs.keys.length;
      offset += MAX_RECORD_SELECTION_PAGE_SIZE
    ) {
      const result = await target.readRecordsByKeys({
        ...fragmentArgs,
        document,
        keys: fragmentArgs.keys.slice(
          offset,
          offset + MAX_RECORD_SELECTION_PAGE_SIZE
        ),
      });
      records.push(...result.records);
    }
    if (records.length !== size)
      throw new Error(`${operation.name}: incomplete fragment batch`);
    return records;
  };
  const read = async (target = host): Promise<unknown> => {
    if (operation.kind === 'fragment') {
      return readFragments(target);
    }
    return assertHit(
      await target.readQuery({
        ...readArgs,
        opKey: 1,
        entityResolvers: corpus.entity_resolvers,
      })
    );
  };
  const seed = async (target: CacheHost, data = fixture): Promise<void> => {
    await target.writeQuery({
      query: data.seed_query ?? operation.document,
      operationName: data.seed_query ? 'BenchmarkSeed' : operation.name,
      variables: data.variables,
      data: data.data,
    });
  };
  const measure = (
    scenario: string,
    run: () => Promise<unknown>,
    setup?: () => Promise<void>
  ) =>
    measurements.measure(
      operation.name,
      size,
      fixture.normalized_records,
      scenario,
      run,
      setup
    );
  try {
    let background:
      | { query: string; batches: unknown[]; keys: string[] }
      | undefined;
    if (cacheRecords !== undefined) {
      const population = fixture.populations?.find(
        (item) => item.cache_records === cacheRecords
      );
      if (!population || !fixture.record_keys)
        throw new Error('population fixture was not exported');
      const response = await fetch(`/fixtures/${population.file}`);
      if (!response.ok)
        throw new Error(`population fixture: HTTP ${response.status}`);
      background = await response.json();
      if (
        !background ||
        fixture.normalized_records + background.keys.length !== cacheRecords
      )
        throw new Error('population record count differs');
      for (const data of background.batches)
        await host.writeQuery({
          query: background.query,
          operationName: 'BenchmarkPopulation',
          data,
        });
      measurements.population = {
        cache_records: cacheRecords,
        hot_capacity: 10_000,
      };
    }
    await seed(host);
    if (background) {
      // Verify every background identity survived closing the durable database.
      await closeHost(scope, host);
      host = createHost(scope);
      await readBackground(host, background.keys);
    }
    assertEqual(
      await read(),
      operation.kind === 'fragment' ? fixture.expected : fixture.data,
      operation.name
    );
    if (background && cacheRecords !== undefined) {
      const recordKeys = fixture.record_keys;
      if (!recordKeys) throw new Error('missing normalized record inventory');
      await measure('population-hot', () => read());
      await measure(
        'population-hydrate',
        () => read(),
        async () => {
          await host.invalidate(recordKeys);
        }
      );
      if (!measurements.includes('population-pressure')) return;
      const pressureScope = `${scope}-population-pressure`;
      const pressure = createHost(pressureScope, 1_000);
      try {
        for (const data of background.batches)
          await pressure.writeQuery({
            query: background.query,
            operationName: 'BenchmarkPopulation',
            data,
          });
        await seed(pressure);
        measurements.population = {
          cache_records: cacheRecords,
          hot_capacity: 1_000,
        };
        await measure(
          'population-pressure',
          () => read(pressure),
          () => readBackground(pressure, background.keys)
        );
        assertEqual(
          await read(pressure),
          operation.kind === 'fragment' ? fixture.expected : fixture.data,
          `${operation.name} after pressure`
        );
      } finally {
        await closeHost(pressureScope, pressure);
      }
      return;
    }
    if (operation.kind === 'query') {
      await measure('hot', async () =>
        assertHit(await host.readQuery(readArgs))
      );
      await measure('hot-registered', async () =>
        assertHit(await host.readQuery({ ...readArgs, opKey: 1 }))
      );
      await measure('hot-resolvers', () => read());
      await measure('hot-json', async () =>
        JSON.stringify(
          assertHit(await host.readQuery({ ...readArgs, opKey: 1 }))
        )
      );
    } else {
      await measure('records-hot', () => read());
      await measure('records-json', async () => JSON.stringify(await read()));
      let version = 0;
      await measure('records-parse', async () => {
        await readFragments(
          host,
          `${operation.document}\n# benchmark-cold-plan-${version++}`
        );
      });
    }
    await measure('unchanged-write', () => seed(host));
    if (measurements.includes('concurrent-8-total')) {
      const clients = Array.from({ length: 8 }, () => createHost(scope));
      try {
        await Promise.all(clients.map((client) => client.currentRevision()));
        await measure('concurrent-8-total', () =>
          Promise.all(clients.map((client) => read(client)))
        );
      } finally {
        for (const client of clients) client.dispose();
      }
    }
    await measure(
      'reopen-first-read',
      () => read(),
      async () => {
        await closeHost(scope, host);
        host = createHost(scope);
      }
    );
    // Verify reopen preserved durable content, outside timing.
    assertEqual(
      await read(),
      operation.kind === 'fragment' ? fixture.expected : fixture.data,
      `${operation.name} reopened`
    );
    if (operation.kind === 'query' && files.length > 1) {
      let seeded = 1;
      for (const variants of [...measurements.options.variants].sort(
        (a, b) => a - b
      )) {
        if (!measurements.includes(`variants-${variants}`)) continue;
        while (seeded < variants) {
          await seed(host, await loadFixture(files[seeded]));
          seeded++;
        }
        assertEqual(await read(), fixture.data, `${operation.name} variants`);
        await measure(`variants-${variants}`, () => read());
      }
    }
    if (measurements.includes('capacity-16')) {
      const pressuredScope = `${scope}-pressure`;
      const pressured = createHost(pressuredScope, 16);
      try {
        await seed(pressured);
        assertEqual(
          await read(pressured),
          operation.kind === 'fragment' ? fixture.expected : fixture.data,
          `${operation.name} pressure`
        );
        await measure('capacity-16', () => read(pressured));
      } finally {
        await closeHost(pressuredScope, pressured);
      }
    }
    if (operation.kind === 'query' && measurements.includes('miss')) {
      const emptyScope = `${scope}-miss`;
      const empty = createHost(emptyScope);
      try {
        await empty.currentRevision();
        await measurements.measure(
          operation.name,
          size,
          0,
          'miss',
          async () => {
            const result = await empty.readQuery({ ...readArgs, opKey: 1 });
            if (result.kind !== 'miss')
              throw new Error('empty cache unexpectedly hit');
          }
        );
      } finally {
        await closeHost(emptyScope, empty);
      }
    }
  } finally {
    await closeHost(scope, host);
    measurements.population = undefined;
  }
}

async function readBackground(host: CacheHost, keys: string[]): Promise<void> {
  for (
    let offset = 0;
    offset < keys.length;
    offset += MAX_RECORD_SELECTION_PAGE_SIZE
  ) {
    const batch = keys.slice(offset, offset + MAX_RECORD_SELECTION_PAGE_SIZE);
    const result = await host.readRecordsByKeys({
      document:
        'fragment Background on GraphqlSoupDocument { __typename id name createdAt updatedAt }',
      fragmentName: 'Background',
      keys: batch,
    });
    if (
      result.records.length !== batch.length ||
      result.records.some((record, index) => record.recordKey !== batch[index])
    )
      throw new Error('durable background record inventory differs');
  }
}

function timerResolution(): number {
  let previous = performance.now();
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < 100_000; index++) {
    const current = performance.now();
    if (current > previous) minimum = Math.min(minimum, current - previous);
    previous = current;
  }
  return minimum * 1000;
}

window.runGraphqlCacheBenchmark = async (
  corpus,
  options
): Promise<BrowserBenchmarkResult> => {
  const measurements = new Measurements(options);
  const resolution = timerResolution();
  for (const operation of corpus.inventory) {
    if (!operation.name.includes(options.filter)) continue;
    for (const { size, files } of operation.sizes) {
      if (!options.sizes.includes(size)) continue;
      if (options.cache_records.length) {
        for (const records of options.cache_records)
          await runCase(corpus, operation, size, files, measurements, records);
      } else {
        await runCase(corpus, operation, size, files, measurements);
      }
    }
  }
  if (measurements.rows.length === 0)
    throw new Error('no benchmark scenarios matched');
  return {
    rows: measurements.rows,
    cross_origin_isolated: crossOriginIsolated,
    timer_resolution_us: resolution,
  };
};

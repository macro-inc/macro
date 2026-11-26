import fc from 'fast-check';
import { match } from 'ts-pattern';
import { describe, expect, it, vi } from 'vitest';
import { TEST_AUTHORITY_GENERATION, testAuthority } from '../authority-fixture';
import { type CacheRequest, INITIAL_CACHE_REVISION } from '../protocol';

const loadCacheWasmMock = vi.hoisted(() => vi.fn());

vi.mock('./wasm-module', () => ({
  loadCacheWasm: async () => {
    const module = await loadCacheWasmMock();
    return {
      ...module,
      openCache: async (...args: unknown[]) => ({
        currentAuthority: async (identity: string) => testAuthority(identity),
        ...(await module.openCache(...args)),
      }),
    };
  },
}));

import { OperationIndex, operationsOf } from './operation-order';
import { CacheWorkerCore } from './worker-core';

const RUNS = 400;
const OPS = ['client:a', 'client:b', 'client:c', 'client:d'];
const BLOCKER = 'client:blocker';

type EngineEvent =
  | { kind: 'read'; op: string | undefined; signature: string }
  | { kind: 'teardown'; op: string }
  | { kind: 'write' | 'local-change' | 'hydrate'; tag: number; ops: string[] }
  | { kind: 'generation' };

/** A request in a random queue; ids are given when the queue is built. */
type Step =
  | { kind: 'read'; op: string; variant: number; visible: boolean }
  | { kind: 'teardown'; op: string }
  | { kind: 'write'; registration?: string; origin?: string }
  | { kind: 'local-change'; origin?: string }
  | { kind: 'hydrate' }
  | { kind: 'generation' };

const op = fc.constantFrom(...OPS);
const maybeOp = fc.option(op, { nil: undefined });
const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 10,
    arbitrary: fc.record({
      kind: fc.constant('read' as const),
      op,
      // Two queries per operation, so some reads share a signature.
      variant: fc.constantFrom(0, 1),
      visible: fc.boolean(),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({ kind: fc.constant('teardown' as const), op }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('write' as const),
      registration: maybeOp,
      origin: maybeOp,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('local-change' as const),
      origin: maybeOp,
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'hydrate' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'generation' as const }) }
);

function toRequest(step: Step, id: number): CacheRequest {
  const generation = TEST_AUTHORITY_GENERATION;
  return match(step)
    .returnType<CacheRequest>()
    .with({ kind: 'read' }, ({ op, variant, visible }) => ({
      id,
      kind: 'read',
      opId: op,
      query: `query Q${variant} { q${variant} }`,
      ...(visible ? { priority: 'user-visible' as const } : {}),
    }))
    .with({ kind: 'teardown' }, ({ op }) => ({
      id,
      kind: 'teardown',
      opId: op,
    }))
    .with({ kind: 'write' }, ({ registration, origin }) => ({
      id,
      generation,
      kind: 'write',
      query: 'query W { w }',
      data: { tag: id },
      ...(registration === undefined
        ? {}
        : { registration: { opId: registration } }),
      ...(origin === undefined ? {} : { originOpId: origin }),
    }))
    .with({ kind: 'local-change' }, ({ origin }) => ({
      id,
      generation,
      kind: 'enqueue-optimistic-mutation',
      uuid: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
      query: 'mutation M { m }',
      data: { tag: id },
      createdAtMs: id,
      owner: 'runner',
      nowMs: id,
      leaseExpiresAtMs: id + 1_000,
      ...(origin === undefined ? {} : { originOpId: origin }),
    }))
    .with({ kind: 'hydrate' }, () => ({
      id,
      generation,
      kind: 'hydrate',
      query: 'query H { h }',
      data: { tag: id },
    }))
    .with({ kind: 'generation' }, () => ({
      id,
      kind: 'current-storage-generation',
    }))
    .exhaustive();
}

/**
 * An engine that records each call and which operations stay registered.
 * `arrive` runs once, when the engine has recorded `arriveAfter` calls, so a
 * second batch of requests can be queued while the first drains.
 */
function recordingEngine(arriveAfter = Number.POSITIVE_INFINITY) {
  const events: EngineEvent[] = [];
  const registered = new Set<string>();
  const blocker = Promise.withResolvers<void>();
  const blockerStarted = Promise.withResolvers<void>();
  let arrive = () => {};
  const record = (event: EngineEvent) => {
    events.push(event);
    if (events.length === arriveAfter) arrive();
  };
  const written = {
    changed: [],
    reset: false,
    revision: INITIAL_CACHE_REVISION,
  };
  const engine = {
    readQuery: async (opId: string | undefined, query: string) => {
      if (opId === BLOCKER) {
        blockerStarted.resolve();
        await blocker.promise;
        return { kind: 'miss' as const };
      }
      record({ kind: 'read', op: opId, signature: `${opId}|${query}` });
      if (opId !== undefined) registered.add(opId);
      return { kind: 'miss' as const };
    },
    teardownOperation: async (opId: string) => {
      record({ kind: 'teardown', op: opId });
      registered.delete(opId);
    },
    writeQuery: async (
      meta: { originOpId?: string; registration?: { opId: string } },
      _query: string,
      _operationName: unknown,
      _variables: unknown,
      data: { tag: number }
    ) => {
      record({
        kind: 'write',
        tag: data.tag,
        ops: [meta.registration?.opId, meta.originOpId].filter(
          (op): op is string => op !== undefined
        ),
      });
      if (meta.registration) registered.add(meta.registration.opId);
      return { ...written, affectedOps: [...registered] };
    },
    hydrateQuery: async (
      _query: string,
      _operationName: unknown,
      _variables: unknown,
      data: { tag: number }
    ) => {
      record({ kind: 'hydrate', tag: data.tag, ops: [] });
      return { ...written, data: null };
    },
    enqueueOptimisticMutation: async (
      originOpId: string | undefined,
      _uuid: string,
      _query: string,
      _operationName: unknown,
      _variables: unknown,
      data: { tag: number }
    ) => {
      record({
        kind: 'local-change',
        tag: data.tag,
        ops: originOpId === undefined ? [] : [originOpId],
      });
      return {
        ...written,
        affectedOps: [...registered],
        transactionId: String(data.tag),
        upsertKind: { kind: 'inserted' as const },
        initialClaim: { kind: 'not-runnable' as const },
      };
    },
    currentStorageGeneration: async () => {
      record({ kind: 'generation' });
      return '00000000-0000-4000-8000-000000000001';
    },
  };
  return {
    engine,
    events,
    registered,
    blocker,
    blockerStarted,
    onArrival: (send: () => void) => {
      arrive = send;
    },
  };
}

/**
 * Queues `first` behind a running read and lets it drain; `later` is queued
 * while it drains, once the engine has run `arriveAfter` calls (or at the
 * end). Returns the responses.
 */
async function run(
  first: readonly CacheRequest[],
  later: readonly CacheRequest[] = [],
  arriveAfter?: number
) {
  const recording = recordingEngine(arriveAfter);
  loadCacheWasmMock.mockResolvedValue({
    openCache: vi.fn().mockResolvedValue(recording.engine),
  });
  const core = new CacheWorkerCore();
  const responses: { id: number; ok: boolean }[] = [];
  const port = {
    postMessage: (message: { id: number; ok: boolean }) =>
      responses.push(message),
  };
  await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope-1' });
  const running = core.handleRequest(port, {
    id: 2,
    kind: 'read',
    opId: BLOCKER,
    query: 'query Blocker { blocker }',
  });
  await recording.blockerStarted.promise;
  const sent = first.map((request) => core.handleRequest(port, request));
  let arrived = false;
  const sendLater = () => {
    if (arrived) return;
    arrived = true;
    sent.push(...later.map((request) => core.handleRequest(port, request)));
  };
  recording.onArrival(sendLater);
  recording.blocker.resolve();
  await Promise.all([running, ...sent]);
  sendLater();
  // Requests that arrived during the drain were added to `sent` after the
  // wait above began.
  await Promise.all(sent);
  return { ...recording, responses };
}

/**
 * Every place a request has to keep: the run between two lifecycle barriers,
 * and for each operation it is about, the run between two of that
 * operation's teardowns. Counted in queue order and in the engine's log, the
 * two must agree for every request. Returns the violations.
 */
function violations(
  requests: readonly CacheRequest[],
  events: readonly EngineEvent[]
): string[] {
  const found: string[] = [];
  const placeAll = (items: readonly { kind: string; ops: string[] }[]) => {
    let barriers = 0;
    const teardowns = new Map<string, number>();
    return items.map(({ kind, ops }) => {
      const at = JSON.stringify([
        barriers,
        ...ops.map((op) => `${op}#${teardowns.get(op) ?? 0}`),
      ]);
      if (kind === 'generation') barriers += 1;
      if (kind === 'teardown')
        for (const op of ops) teardowns.set(op, (teardowns.get(op) ?? 0) + 1);
      return at;
    });
  };
  const queued = placeAll(
    requests.map((request) => ({
      kind:
        request.kind === 'current-storage-generation'
          ? 'generation'
          : request.kind,
      ops: [...operationsOf(request)],
    }))
  );
  const logged = placeAll(
    events.map((event) => ({
      kind: event.kind,
      ops:
        'ops' in event
          ? event.ops
          : 'op' in event && event.op !== undefined
            ? [event.op]
            : [],
    }))
  );

  const ran = new Set<string>();
  events.forEach((event, i) => {
    if (event.kind === 'read') ran.add(`${event.signature}@${logged[i]}`);
    if ('tag' in event) ran.add(`${event.tag}@${logged[i]}`);
  });
  requests.forEach((request, i) => {
    const name =
      request.kind === 'read'
        ? `${request.opId}|${request.query}`
        : request.kind === 'write' ||
            request.kind === 'hydrate' ||
            request.kind === 'enqueue-optimistic-mutation'
          ? String(request.id)
          : undefined;
    if (name !== undefined && !ran.has(`${name}@${queued[i]}`))
      found.push(`${request.kind} ${request.id} did not run at ${queued[i]}`);
  });

  // The placement above counts teardowns and barriers, so each must run
  // exactly as often as it was queued.
  for (const [queuedKind, loggedKind] of [
    ['teardown', 'teardown'],
    ['current-storage-generation', 'generation'],
  ]) {
    const inQueue = requests.filter((r) => r.kind === queuedKind).length;
    const inLog = events.filter((e) => e.kind === loggedKind).length;
    if (inQueue !== inLog) found.push(`${queuedKind}: ${inQueue} -> ${inLog}`);
  }

  // Authoritative writes keep their queue order.
  const writesQueued = requests.flatMap((request) =>
    request.kind === 'write' || request.kind === 'hydrate' ? [request.id] : []
  );
  const writesRun = events.flatMap((event) =>
    event.kind === 'write' || event.kind === 'hydrate' ? [event.tag] : []
  );
  if (JSON.stringify(writesQueued) !== JSON.stringify(writesRun))
    found.push(`writes ran as ${writesRun}, queued as ${writesQueued}`);
  return found;
}

/** The operations the queue leaves registered once it drains. */
function expectedRegistered(requests: readonly CacheRequest[]): string[] {
  const registered = new Set<string>();
  for (const request of requests) {
    if (request.kind === 'teardown') registered.delete(request.opId);
    if (request.kind === 'read' && request.opId !== undefined)
      registered.add(request.opId);
    if (request.kind === 'write' && request.registration)
      registered.add(request.registration.opId);
  }
  return [...registered].sort();
}

const read = (id: number, opId: string, visible = false): CacheRequest => ({
  id,
  kind: 'read',
  opId,
  query: `query Q { ${opId.replace(':', '_')} }`,
  ...(visible ? { priority: 'user-visible' as const } : {}),
});
const teardown = (id: number, opId: string): CacheRequest => ({
  id,
  kind: 'teardown',
  opId,
});
async function order(requests: CacheRequest[]) {
  const { events } = await run(requests);
  return events.map((event) =>
    'op' in event ? `${event.kind}:${event.op}` : event.kind
  );
}

function indexed(requests: CacheRequest[]) {
  const entries = requests.map((request, seq) => ({
    request,
    ops: operationsOf(request),
    seq,
  }));
  const index = new OperationIndex<(typeof entries)[number]>();
  for (const entry of entries) index.add(entry);
  const roots = (of: typeof entries) =>
    of.map((entry) => entries.indexOf(index.rootOf(entry)));
  return { entries, index, roots };
}

describe('OperationIndex', () => {
  it('holds requests about an operation behind its teardown, and its teardown behind them', () => {
    const { entries, roots } = indexed([
      read(1, 'a'),
      read(2, 'b'),
      teardown(3, 'a'),
      read(4, 'a'),
      read(5, 'c'),
      teardown(6, 'a'),
    ]);
    expect(roots(entries)).toEqual([0, 1, 0, 0, 4, 0]);
  });

  it('holds a teardown with nothing ahead about its operation back from nothing', () => {
    const { entries, roots } = indexed([
      read(1, 'b'),
      teardown(2, 'a'),
      read(3, 'a'),
    ]);
    expect(roots(entries)).toEqual([0, 1, 1]);
  });

  it('frees what waited for a request once it leaves the queue', () => {
    const { entries, index, roots } = indexed([
      read(1, 'a'),
      read(2, 'b'),
      teardown(3, 'a'),
      read(4, 'a'),
      read(5, 'c'),
      teardown(6, 'a'),
    ]);
    const [first, ...rest] = entries;
    if (first) index.remove(first);
    expect(roots(rest)).toEqual([1, 2, 2, 4, 2]);
    expect(index.hasTeardowns).toBe(true);
    for (const entry of rest)
      if (entry.request.kind === 'teardown') index.remove(entry);
    expect(index.hasTeardowns).toBe(false);
    const reads = rest.filter((entry) => entry.request.kind !== 'teardown');
    expect(roots(reads)).toEqual([1, 3, 4]);
  });

  it('finds the last matching request about an operation, reading back only to a fence', () => {
    const { entries, index } = indexed([
      read(1, 'a'),
      read(2, 'b'),
      teardown(3, 'a'),
      read(4, 'a'),
      read(5, 'a'),
    ]);
    const isRead = (entry: (typeof entries)[number]) =>
      entry.request.kind === 'read';
    const found = (after: number) => {
      const entry = index.lastOf('a', after, isRead);
      return entry === undefined ? undefined : entries.indexOf(entry);
    };
    expect(found(-1)).toBe(4);
    expect(found(3)).toBe(4);
    expect(found(4)).toBeUndefined();
    expect(index.lastOf('a', -1, (entry) => entry.seq < 3)).toBe(entries[2]);
    expect(index.lastOf('c', -1, isRead)).toBeUndefined();
  });
});

describe('operation teardown order', () => {
  it('lets requests about other operations pass a teardown', async () => {
    expect(
      await order([
        read(10, 'client:list-1'),
        read(11, 'client:list-2'),
        teardown(12, 'client:gone'),
        read(13, 'client:visible', true),
      ])
    ).toEqual([
      'read:client:visible',
      'read:client:list-1',
      'read:client:list-2',
      'teardown:client:gone',
    ]);
  });

  it("runs a remount's visible read, and what it waits for, ahead of other reads", async () => {
    expect(
      await order([
        read(10, 'client:list-1'),
        read(11, 'client:view'),
        read(12, 'client:list-2'),
        teardown(13, 'client:view'),
        read(14, 'client:view', true),
      ])
    ).toEqual([
      'read:client:view',
      'teardown:client:view',
      'read:client:view',
      'read:client:list-1',
      'read:client:list-2',
    ]);
  });

  it('lends a remount’s priority past the write order to the first write', async () => {
    // The remount waits for the teardown, which waits for a write that waits
    // for the background hydrate: the hydrate runs first, not the later read.
    expect(
      await order([
        {
          id: 10,
          generation: TEST_AUTHORITY_GENERATION,
          kind: 'hydrate',
          query: 'query H { h }',
          data: { tag: 10 },
        },
        {
          id: 11,
          generation: TEST_AUTHORITY_GENERATION,
          kind: 'write',
          query: 'query W { w }',
          data: { tag: 11 },
          registration: { opId: 'client:view' },
        },
        teardown(12, 'client:view'),
        read(13, 'client:view', true),
        read(14, 'client:other', true),
      ])
    ).toEqual([
      'hydrate',
      'write',
      'teardown:client:view',
      'read:client:view',
      'read:client:other',
    ]);
  });

  it('lends nothing from a write that waits on the write order', async () => {
    // The second write waits for the first write and for the teardown. It
    // can't run first either way, so it doesn't hurry the teardown past the
    // first write.
    expect(
      await order([
        teardown(10, 'client:gone'),
        {
          id: 11,
          generation: TEST_AUTHORITY_GENERATION,
          kind: 'write',
          query: 'query W { w }',
          data: { tag: 11 },
        },
        {
          id: 12,
          generation: TEST_AUTHORITY_GENERATION,
          kind: 'write',
          query: 'query G { g }',
          data: { tag: 12 },
          registration: { opId: 'client:gone' },
        },
        read(13, 'client:other'),
      ])
    ).toEqual(['write', 'teardown:client:gone', 'write', 'read:client:other']);
  });

  it('keeps, for random queues, every request between its operation’s teardowns and lifecycle barriers, and writes in order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(step, { minLength: 1, maxLength: 60 }),
        fc.array(step, { maxLength: 20 }),
        fc.nat(60),
        async (firstSteps, laterSteps, arriveAfter) => {
          const first = firstSteps.map((s, i) => toRequest(s, 100 + i));
          const later = laterSteps.map((s, i) => toRequest(s, 200 + i));
          const requests = [...first, ...later];
          const { events, registered, responses } = await run(
            first,
            later,
            arriveAfter
          );
          expect(violations(requests, events)).toEqual([]);
          expect([...registered].sort()).toEqual(expectedRegistered(requests));
          const answered = responses
            .filter((response) => response.id >= 100)
            .map((response) => [response.id, response.ok]);
          expect(answered.sort(([a], [b]) => Number(a) - Number(b))).toEqual(
            requests.map((request) => [request.id, true])
          );
        }
      ),
      { numRuns: RUNS }
    );
  });
});

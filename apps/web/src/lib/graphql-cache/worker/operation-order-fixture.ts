import { TEST_AUTHORITY_GENERATION } from '../authority-fixture';
import { type CacheRequest, INITIAL_CACHE_REVISION } from '../protocol';
import { operationsOf } from './operation-order';

/**
 * Random queues of requests about a few operations, run through a worker core
 * over an engine that records what it was asked to do, and the properties the
 * queue's order must keep (`operation-order.ts`): per operation, teardowns
 * split its requests into runs that never cross; writes keep their order;
 * nothing crosses a lifecycle barrier.
 */

const OPS = ['client:a', 'client:b', 'client:c', 'client:d'];
const BLOCKER = 'client:blocker';

export type EngineEvent =
  | { kind: 'read'; op: string | undefined; signature: string }
  | { kind: 'teardown'; op: string }
  | { kind: 'write'; tag: number; ops: string[] }
  | { kind: 'local-change'; tag: number; ops: string[] }
  | { kind: 'generation'; tag: number };

export type Scenario = { seed: number; requests: CacheRequest[] };

type Core = {
  handleRequest(
    port: { postMessage(message: unknown): void },
    request: CacheRequest
  ): Promise<void>;
};

/** A seeded PRNG (mulberry32), so a failing seed replays exactly. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function scenario(seed: number): Scenario {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(next() * items.length)] as T;
  const requests: CacheRequest[] = [];
  const count = 10 + Math.floor(next() * 50);
  for (let n = 0; n < count; n += 1) {
    const id = 100 + n;
    const roll = next();
    if (roll < 0.5) {
      // Two queries per operation, so some reads share a signature.
      const variant = pick([0, 1]);
      requests.push({
        id,
        kind: 'read',
        opId: pick(OPS),
        query: `query Q${variant} { q${variant} }`,
        ...(next() < 0.5 ? { priority: 'user-visible' as const } : {}),
      });
    } else if (roll < 0.72) {
      requests.push({ id, kind: 'teardown', opId: pick(OPS) });
    } else if (roll < 0.87) {
      requests.push({
        id,
        generation: TEST_AUTHORITY_GENERATION,
        kind: 'write',
        query: 'query W { w }',
        data: { w: id },
        ...(next() < 0.6 ? { registration: { opId: pick(OPS) } } : {}),
        ...(next() < 0.3 ? { originOpId: pick(OPS) } : {}),
      });
    } else if (roll < 0.95) {
      requests.push({
        id,
        generation: TEST_AUTHORITY_GENERATION,
        kind: 'enqueue-optimistic-mutation',
        uuid: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
        query: 'mutation M { m }',
        data: { m: id },
        createdAtMs: id,
        owner: 'runner',
        nowMs: id,
        leaseExpiresAtMs: id + 1_000,
        ...(next() < 0.5 ? { originOpId: pick(OPS) } : {}),
      });
    } else {
      requests.push({ id, kind: 'current-storage-generation' });
    }
  }
  return { seed, requests };
}

/** A promise and the function that settles it. */
function settable(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** An engine that records each call, and which operations stay registered. */
export function recordingEngine() {
  const events: EngineEvent[] = [];
  const registered = new Set<string>();
  const blocker = settable();
  const blockerStarted = settable();
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
      events.push({ kind: 'read', op: opId, signature: `${opId}|${query}` });
      if (opId !== undefined) registered.add(opId);
      return { kind: 'miss' as const };
    },
    teardownOperation: async (opId: string) => {
      events.push({ kind: 'teardown', op: opId });
      registered.delete(opId);
    },
    writeQuery: async (
      meta: { originOpId?: string; registration?: { opId: string } },
      _query: string,
      _operationName: unknown,
      _variables: unknown,
      data: { w: number }
    ) => {
      const ops = [meta.registration?.opId, meta.originOpId].filter(
        (op): op is string => op !== undefined
      );
      events.push({ kind: 'write', tag: data.w, ops });
      if (meta.registration) registered.add(meta.registration.opId);
      return { ...written, affectedOps: [...registered] };
    },
    enqueueOptimisticMutation: async (
      originOpId: string | undefined,
      _uuid: string,
      _query: string,
      _operationName: unknown,
      _variables: unknown,
      data: { m: number }
    ) => {
      events.push({
        kind: 'local-change',
        tag: data.m,
        ops: originOpId === undefined ? [] : [originOpId],
      });
      return {
        ...written,
        affectedOps: [...registered],
        transactionId: String(data.m),
        upsertKind: { kind: 'inserted' as const },
        initialClaim: { kind: 'not-runnable' as const },
      };
    },
    currentStorageGeneration: async () => {
      events.push({ kind: 'generation', tag: events.length });
      return '00000000-0000-4000-8000-000000000001';
    },
  };
  return { engine, events, registered, blocker, blockerStarted };
}

/** Queues the whole scenario behind a running read, then lets it drain. */
export async function run(
  core: Core,
  recording: ReturnType<typeof recordingEngine>,
  requests: readonly CacheRequest[]
): Promise<void> {
  const port = { postMessage: () => undefined };
  await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope-1' });
  const running = core.handleRequest(port, {
    id: 2,
    kind: 'read',
    opId: BLOCKER,
    query: 'query Blocker { blocker }',
  });
  await recording.blockerStarted.promise;
  const sent = requests.map((request) => core.handleRequest(port, request));
  recording.blocker.resolve();
  await Promise.all([running, ...sent]);
}

const signatureOf = (request: CacheRequest) =>
  request.kind === 'read' ? `${request.opId}|${request.query}` : undefined;

const tagOf = (request: CacheRequest): number | undefined =>
  request.kind === 'teardown' || request.kind === 'read'
    ? undefined
    : request.id;

/**
 * Where each request may run: the run of requests between two lifecycle
 * barriers, and for each operation it is about, the run between two of that
 * operation's teardowns. Returns the violations found.
 */
export function violations(
  requests: readonly CacheRequest[],
  events: readonly EngineEvent[]
): string[] {
  const found: string[] = [];
  // The k-th barrier and each operation's k-th teardown, counted in the
  // queue and in the engine's log, must bound the same requests.
  const place = (
    sequence: readonly (CacheRequest | EngineEvent)[],
    isRequest: boolean
  ) => {
    let barriers = 0;
    const teardowns = new Map<string, number>();
    return sequence.map((item) => {
      const kind = item.kind;
      const ops = isRequest
        ? operationsOf(item as CacheRequest)
        : 'ops' in item
          ? item.ops
          : 'op' in item && item.op !== undefined
            ? [item.op]
            : [];
      const at = {
        barrier: barriers,
        teardowns: ops.map((op) => `${op}#${teardowns.get(op) ?? 0}`),
      };
      if (kind === 'current-storage-generation' || kind === 'generation')
        barriers += 1;
      if (kind === 'teardown')
        for (const op of ops) teardowns.set(op, (teardowns.get(op) ?? 0) + 1);
      return at;
    });
  };
  const queued = place(requests, true);
  const logged = place(events, false);
  const key = (at: { barrier: number; teardowns: string[] }) =>
    JSON.stringify([at.barrier, ...at.teardowns]);

  const readsRun = new Set<string>();
  const tagsRun = new Map<number, string>();
  events.forEach((event, i) => {
    const at = logged[i];
    if (!at) return;
    if (event.kind === 'read') readsRun.add(`${event.signature}@${key(at)}`);
    if (event.kind === 'write' || event.kind === 'local-change')
      tagsRun.set(event.tag, key(at));
  });
  requests.forEach((request, i) => {
    const at = queued[i];
    if (!at) return;
    const signature = signatureOf(request);
    if (signature !== undefined && !readsRun.has(`${signature}@${key(at)}`))
      found.push(`read ${request.id} (${signature}) did not run at ${key(at)}`);
    const tag = tagOf(request);
    if (
      tag !== undefined &&
      (request.kind === 'write' ||
        request.kind === 'enqueue-optimistic-mutation') &&
      tagsRun.get(tag) !== key(at)
    )
      found.push(
        `${request.kind} ${request.id} ran at ${tagsRun.get(tag)}, queued at ${key(at)}`
      );
  });

  // Each operation's teardowns, and the lifecycle barriers, ran as many
  // times as they were queued (the placement above relies on their counts).
  const count = (items: readonly { kind: string }[], kind: string) =>
    items.filter((item) => item.kind === kind).length;
  if (count(requests, 'teardown') !== count(events, 'teardown'))
    found.push('teardowns ran a different number of times');
  if (
    count(requests, 'current-storage-generation') !==
    count(events, 'generation')
  )
    found.push('barriers ran a different number of times');

  // Authoritative writes keep their queue order.
  const writesQueued = requests
    .filter((request) => request.kind === 'write')
    .map((request) => request.id);
  const writesRun = events.flatMap((event) =>
    event.kind === 'write' ? [event.tag] : []
  );
  if (JSON.stringify(writesQueued) !== JSON.stringify(writesRun))
    found.push(`writes ran as ${writesRun}, queued as ${writesQueued}`);
  return found;
}

/**
 * The operations registered once the queue drains: those whose last request
 * after their last teardown registers them.
 */
export function expectedRegistered(
  requests: readonly CacheRequest[]
): string[] {
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

/**
 * What a page sees per operation, whatever unrelated requests passed it: the
 * runs between its teardowns, each with the reads (by signature) and the
 * writes about it that ran there.
 */
export function perOperation(
  events: readonly EngineEvent[]
): Record<string, string[][]> {
  const runs: Record<string, string[][]> = {};
  const current = (op: string) => {
    const list = runs[op] ?? [[]];
    runs[op] = list;
    return list[list.length - 1] as string[];
  };
  for (const event of events) {
    if (event.kind === 'teardown') {
      current(event.op);
      runs[event.op]?.push([]);
    } else if (event.kind === 'read' && event.op !== undefined) {
      const run = current(event.op);
      if (!run.includes(event.signature)) run.push(event.signature);
    } else if (event.kind === 'write' || event.kind === 'local-change') {
      for (const op of event.ops)
        current(op).push(`${event.kind}:${event.tag}`);
    }
  }
  for (const list of Object.values(runs)) for (const run of list) run.sort();
  return Object.fromEntries(
    Object.entries(runs).sort(([left], [right]) => left.localeCompare(right))
  );
}

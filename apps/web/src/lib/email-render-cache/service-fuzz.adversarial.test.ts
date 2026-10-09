/**
 * Model-based fuzzing of EmailRenderCache.
 *
 * Random operation sequences (acquire/release/promote/source changes/executor
 * completion and failure/storage latency, quota, corruption, foreign
 * invalidation/dispose) run against a controllable executor and store. After
 * every step and at quiescence we assert:
 *  - every delivered body (ready or promise) is exactly the preparation of the
 *    lease's own request (no stale/aliased body);
 *  - memory/binding byte accounting matches a recomputation and is never
 *    negative; leased bodies are never evicted;
 *  - a live foreground lease (unreleased, source still current, not disposed)
 *    is never cancelled with AbortError;
 *  - nothing hangs: after quiescence every lease settled, the artifact map,
 *    scheduler queue and write timers are empty;
 *  - after releasing everything no memory lease leaks, bytes are within budget,
 *    and every request is preparable again (failures are retryable);
 *  - persistence holds only records equal to their key's preparation, no write
 *    starts after dispose, and no unhandled rejection escapes.
 *
 * Reproduce one seed with FUZZ_SEED=<n>; scale with FUZZ_SEEDS / FUZZ_STEPS.
 */
import { inspect } from 'node:util';
import type { PreparedEmailBody } from '@macro-inc/email-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EmailPreparationRequest,
  PreparedEmailLease,
} from '../../features/email-message/context/email-preparation';
import type { PreparationExecutor } from './executor';
import { policyTuple, sourceBytes, sourceTuple } from './keys';
import { EmailRenderCache } from './service';
import {
  ARTIFACT_SCHEMA_VERSION,
  type Artifact,
  type ArtifactStore,
  artifactBytes,
} from './store';

// ---------------------------------------------------------------- utilities

function mulberry32(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(values: readonly T[]): T =>
      values[Math.floor(next() * values.length)],
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof mulberry32>;

const ticks = async (n: number) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

function expectedBody(
  input: EmailPreparationRequest['input'],
  options: EmailPreparationRequest['options']
): PreparedEmailBody {
  return {
    html: JSON.stringify([sourceTuple(input), policyTuple(options)]),
    kind: 'html',
    hasTable: false,
    hasHiddenContent: false,
  };
}

const sameBody = (a: PreparedEmailBody, b: PreparedEmailBody) =>
  a.html === b.html &&
  a.kind === b.kind &&
  a.hasTable === b.hasTable &&
  a.hasHiddenContent === b.hasHiddenContent;

// ----------------------------------------------------------------- universe

const MAILBOXES = ['m1', 'm2'];
const MESSAGES = ['a', 'b', 'c', 'd', 'e'];
// A large shared source exercises the 256 KiB speculative skip without
// allocating per use.
const BIG = `<p>${'x'.repeat(140 * 1024)}</p>`;
function sourceFor(message: string, version: number) {
  if (version === 0) return { html: '<p>shared</p>' }; // cross-message dedupe
  if (version === 3) return { html: BIG };
  if (version === 4) return { html: null, text: `text ${message}` };
  return { html: `<p>${message} v${version}</p>`, replylessHtml: null };
}
const POLICIES: EmailPreparationRequest['options'][] = [];
for (const showQuotedContent of [false, true])
  for (const showFullContent of [false, true])
    for (const images of [
      undefined,
      { remote: 'block' as const },
      { remote: 'allow' as const, proxyUrl: 'https://proxy/' },
    ])
      POLICIES.push({ showQuotedContent, showFullContent, images });

// ------------------------------------------------------------ fake executor

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

class FakeExecutor implements PreparationExecutor {
  disposed = false;
  failures = 0; // probability of an injected failure
  pending: {
    input: EmailPreparationRequest['input'];
    options: EmailPreparationRequest['options'];
    priority: number | undefined;
    deferred: Deferred<PreparedEmailBody>;
  }[] = [];
  constructor(private rng: Rng) {}
  async hash(tuple: string): Promise<string> {
    if (this.disposed) throw new Error('Preparation executor disposed');
    await ticks(this.rng.int(0, 4));
    return `H:${tuple}`;
  }
  async hashSource(input: EmailPreparationRequest['input']): Promise<string> {
    if (this.disposed) throw new Error('Preparation executor disposed');
    await ticks(this.rng.int(0, 4));
    if (this.failures && this.rng.chance(this.failures))
      throw new Error('injected hash failure');
    return `S:${sourceTuple(input)}`;
  }
  prepare(
    input: EmailPreparationRequest['input'],
    options: EmailPreparationRequest['options'],
    priority?: number
  ): Promise<PreparedEmailBody> {
    if (this.disposed)
      return Promise.reject(new Error('Preparation executor disposed'));
    const deferred = Promise.withResolvers<PreparedEmailBody>();
    this.pending.push({ input, options, priority, deferred });
    return deferred.promise;
  }
  settle(index: number, fail: boolean) {
    const [job] = this.pending.splice(index, 1);
    if (fail) job.deferred.reject(new Error('injected prepare failure'));
    else job.deferred.resolve(expectedBody(job.input, job.options));
  }
  dispose() {
    this.disposed = true;
    for (const job of this.pending.splice(0))
      job.deferred.reject(new Error('Preparation worker stopped'));
  }
}

// --------------------------------------------------------------- fake store

class FakeStore implements ArtifactStore {
  records = new Map<string, unknown>();
  gen = 0;
  quota = 0;
  writesAfterDispose = 0;
  isDisposed = () => false;
  constructor(private rng: Rng) {}
  private later<T>(value: () => T, max: number): Promise<T> {
    const delay = this.rng.int(0, max);
    return new Promise((resolve) => setTimeout(() => resolve(value()), delay));
  }
  generation() {
    return this.later(() => this.gen, 40);
  }
  hits = 0;
  read(key: string) {
    // Up to twice the 150 ms read deadline: late values must be ignored.
    return this.later(() => {
      const value = this.records.get(key);
      if (value) this.hits++;
      return value;
    }, 300);
  }
  async write(generation: number, artifact: Artifact): Promise<boolean> {
    if (this.isDisposed()) this.writesAfterDispose++;
    await ticks(this.rng.int(0, 3));
    if (this.quota && this.rng.chance(this.quota))
      throw new DOMException('Quota', 'QuotaExceededError');
    if (generation !== this.gen) return false;
    this.records.set(artifact.key, structuredClone(artifact));
    return true;
  }
  async remove(key: string) {
    this.records.delete(key);
  }
  async invalidate() {
    this.gen++;
    this.records.clear();
  }
  async evict() {
    this.records.clear();
  }
  close() {}
}

// ------------------------------------------------------------------ harness

interface LeaseRecord {
  n: number;
  request: EmailPreparationRequest;
  id: string;
  sourceKey: string;
  lease: PreparedEmailLease;
  released: boolean;
  superseded: boolean;
  joined: boolean;
  settledAt?: number;
  ready?: PreparedEmailBody;
  outcome?:
    | { ok: true; body: PreparedEmailBody }
    | { ok: false; error: unknown };
}

interface Internals {
  bindings: Map<
    string,
    {
      input: EmailPreparationRequest['input'];
      bytes: number;
      variants: Map<
        string,
        { key?: string; consumers: Set<unknown>; pending?: unknown }
      >;
      current: boolean;
    }
  >;
  bindingBytes: number;
  artifacts: Map<string, unknown>;
  scheduler: { queue: unknown[]; running: boolean };
  writes: Set<unknown>;
}

const internals = (cache: EmailRenderCache) => cache as unknown as Internals;
const entries = (cache: EmailRenderCache) =>
  (
    cache.memory as unknown as {
      entries: Map<
        string,
        { body: PreparedEmailBody; bytes: number; leases: number }
      >;
    }
  ).entries;

class Violation extends Error {}

/** Skip triggers of already-reported bugs to look for different ones. */
const AVOID_KNOWN = !!process.env.FUZZ_AVOID_KNOWN;

async function runSeed(seed: number, steps: number) {
  const rng = mulberry32(seed);
  const log: string[] = [];
  const violations: string[] = [];
  const fail = (message: string) => {
    violations.push(message);
    throw new Violation(message);
  };
  const budget = rng.pick([2 * 1024, 64 * 1024, 16 * 1024 * 1024]);
  // Many message identities exercise the 256-binding and byte bounds.
  const wide = rng.chance(0.3);
  let foreignInvalidations = 0;
  const executor = new FakeExecutor(rng);
  const useStore = rng.chance(0.5);
  const store = useStore ? new FakeStore(rng) : undefined;
  const injectFailures = rng.chance(0.3);
  if (injectFailures) executor.failures = 0.08;
  if (store && rng.chance(0.3)) store.quota = 0.2;
  let staleNotices = 0;
  let disposed = false;
  const cache = new EmailRenderCache({
    memoryBytes: budget,
    executor,
    store: store
      ? () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(store), rng.int(0, 400))
          )
      : undefined,
    onStaleGeneration: () => {
      staleNotices++;
      if (disposed) fail('onStaleGeneration after dispose');
    },
  });
  if (store) store.isDisposed = () => disposed;
  if (store && rng.chance(0.5)) cache.initializeStorage();
  log.push(
    `seed=${seed} budget=${budget} store=${useStore} failures=${injectFailures} quota=${store?.quota} wide=${wide}`
  );
  const leases: LeaseRecord[] = [];
  let counter = 0;
  const disposeAt = rng.chance(0.15) ? rng.int(steps / 2, steps - 1) : -1;

  function check(where: string) {
    const state = internals(cache);
    const memEntries = entries(cache);
    let memoryBytes = 0;
    for (const entry of memEntries.values()) {
      memoryBytes += entry.bytes;
      if (entry.leases < 0) fail(`${where}: negative memory lease count`);
    }
    if (memoryBytes !== cache.memory.bytes)
      fail(
        `${where}: memory.bytes ${cache.memory.bytes} != recomputed ${memoryBytes}`
      );
    let bindingBytes = 0;
    for (const binding of state.bindings.values()) {
      let expected = sourceBytes(binding.input) + 256;
      for (const policy of binding.variants.keys())
        expected += policy.length * 2 + 512;
      if (expected !== binding.bytes)
        fail(`${where}: binding.bytes ${binding.bytes} != ${expected}`);
      if (!binding.current) fail(`${where}: non-current binding in map`);
      bindingBytes += binding.bytes;
    }
    if (bindingBytes !== state.bindingBytes)
      fail(
        `${where}: bindingBytes ${state.bindingBytes} != recomputed ${bindingBytes}`
      );
    if (cache.memory.bytes < 0 || state.bindingBytes < 0)
      fail(`${where}: negative bytes`);
    if (
      !disposed &&
      (state.bindings.size > 256 || state.bindingBytes >= budget / 2)
    ) {
      const evictable = [...state.bindings.values()].filter((binding) =>
        [...binding.variants.values()].every(
          (variant) => !variant.consumers.size && !variant.pending
        )
      ).length;
      if (evictable)
        fail(
          `${where}: ${state.bindings.size} bindings / ${state.bindingBytes} bytes over bound while ${evictable} are evictable`
        );
    }
    if (disposed) return;
    for (const record of leases) {
      if (record.released) continue;
      const body =
        record.outcome?.ok === true ? record.outcome.body : record.ready;
      if (!body) continue;
      const pinned = [...memEntries.values()].some(
        (entry) => entry.body === body && entry.leases > 0
      );
      if (!pinned)
        fail(`${where}: lease #${record.n} body evicted while leased`);
    }
  }

  function observe(record: LeaseRecord) {
    record.lease.promise.then(
      (body) => {
        if (record.superseded && !record.ready)
          violations.push(
            `lease #${record.n} resolved with a superseded source`
          );
        record.outcome = { ok: true, body };
        const expected = expectedBody(
          record.request.input,
          record.request.options
        );
        if (!sameBody(body, expected))
          violations.push(
            `lease #${record.n} delivered a body for another request: ${body.html.slice(0, 120)}`
          );
      },
      (error) => {
        record.outcome = { ok: false, error };
        record.settledAt = log.length;
        if (process.env.FUZZ_DEBUG)
          log.push(
            `  -> #${record.n} rejected ${(error as Error).name}: ${(error as Error).stack?.split('\n').slice(1, 4).join(' <')}`
          );
      }
    );
  }

  function pickSpec() {
    if (wide)
      return {
        mailboxId: rng.pick(MAILBOXES),
        messageId: `w${rng.int(0, 400)}`,
        version: rng.chance(0.9) ? 1 : rng.int(0, 2),
        options: rng.chance(0.7) ? POLICIES[0] : rng.pick(POLICIES),
      };
    // Skewed so the same variants recur (memory hits, joins, source flips).
    return {
      mailboxId: rng.chance(0.8) ? 'm1' : rng.pick(MAILBOXES),
      messageId: rng.chance(0.5)
        ? rng.pick(MESSAGES.slice(0, 2))
        : rng.pick(MESSAGES),
      version: rng.chance(0.6)
        ? 1
        : AVOID_KNOWN
          ? rng.pick([0, 1, 2, 4])
          : rng.int(0, 4),
      options: rng.chance(0.5) ? POLICIES[0] : rng.pick(POLICIES),
    };
  }

  function acquire(
    spec = pickSpec(),
    priority = rng.chance(0.5) ? 0 : rng.int(1, 4)
  ) {
    const { mailboxId, messageId, version, options } = spec;
    const request: EmailPreparationRequest = {
      messageId,
      threadId: `t-${messageId}`,
      mailboxId,
      input: { ...sourceFor(messageId, version) },
      options,
      priority,
    };
    const id = JSON.stringify([mailboxId, messageId]);
    const sourceKey = sourceTuple(request.input);
    const n = ++counter;
    // Did this lease join an already-running resolution of its variant?
    const existing = internals(cache).bindings.get(id);
    const joined =
      !!existing &&
      sourceTuple(existing.input) === sourceKey &&
      !!existing.variants.get(policyTuple(options))?.pending;
    let lease: PreparedEmailLease;
    try {
      lease = cache.acquire(request);
    } catch (error) {
      if (!disposed) fail(`acquire #${n} threw while not disposed: ${error}`);
      log.push(`acquire #${n} threw (disposed)`);
      return;
    }
    // util.inspect reads a promise's state synchronously, so only leases still
    // unresolved at this instant count as superseded (no timing slack).
    // Speculation may be refused instead of replacing a source someone is
    // reading; only an acquire that actually rebound the message supersedes.
    const rebound =
      sourceTuple(internals(cache).bindings.get(id)?.input ?? {}) === sourceKey;
    for (const other of leases)
      if (
        rebound &&
        other.id === id &&
        other.sourceKey !== sourceKey &&
        !other.superseded &&
        inspect(other.lease.promise).includes('<pending>')
      )
        other.superseded = true;
    const record: LeaseRecord = {
      n,
      request,
      id,
      sourceKey,
      lease,
      released: false,
      superseded: false,
      joined,
      ready: lease.ready,
    };
    if (
      lease.ready &&
      !sameBody(lease.ready, expectedBody(request.input, request.options))
    )
      fail(`lease #${n} ready body belongs to another request`);
    leases.push(record);
    observe(record);
    log.push(
      `acquire #${n} ${mailboxId}/${messageId} v${version} policy=${POLICIES.indexOf(options)} p${priority}${lease.ready ? ' READY' : ''}`
    );
  }

  const live = () => leases.filter((record) => !record.released);

  async function step(stepIndex: number) {
    const roll = rng.next();
    if (roll < 0.34) acquire();
    else if (roll < 0.4) {
      // Several consumers of one variant in the same tick (e.g. a preparation
      // window and the body effect in one Solid batch).
      const spec = pickSpec();
      const count = rng.int(2, 3);
      log.push(`burst x${count}`);
      for (let i = 0; i < count; i++)
        acquire(spec, AVOID_KNOWN ? 0 : undefined);
    } else if (roll < 0.58) {
      const candidates = live();
      if (!candidates.length) return;
      const record = rng.pick(candidates);
      record.released = true;
      record.lease.release();
      if (rng.chance(0.1)) record.lease.release(); // double release
      log.push(`release #${record.n}`);
    } else if (roll < 0.62) {
      if (!leases.length) return;
      const record = rng.pick(leases);
      record.lease.promote();
      log.push(`promote #${record.n}${record.released ? ' (released)' : ''}`);
    } else if (roll < 0.8) {
      if (!executor.pending.length) return;
      const index = rng.int(0, executor.pending.length - 1);
      const failJob = injectFailures && rng.chance(0.15);
      log.push(
        `${failJob ? 'fail' : 'finish'} prepare[${index}] p${executor.pending[index].priority}`
      );
      executor.settle(index, failJob);
    } else if (roll < 0.9) {
      const ms = rng.pick([0, 1, 20, 100, 151, 300]);
      log.push(`advance ${ms}ms`);
      await vi.advanceTimersByTimeAsync(ms);
    } else if (roll < 0.95) {
      const n = rng.int(0, 12);
      log.push(`flush ${n}`);
      await ticks(n);
    } else if (roll < 0.97) {
      // Let every in-flight job finish, then check the memory budget holds
      // for everything that is not pinned by a lease.
      log.push('settle');
      const failures = executor.failures;
      await quiesce();
      executor.failures = failures;
      if (!disposed) {
        const state = internals(cache);
        const unpinned = [...entries(cache).values()].filter(
          (entry) => !entry.leases
        ).length;
        if (cache.memory.bytes + state.bindingBytes > budget && unpinned) {
          if (process.env.FUZZ_DEBUG)
            for (const [key, entry] of entries(cache)) {
              const owners = [...state.bindings].flatMap(([id, binding]) =>
                [...binding.variants]
                  .filter(([, variant]) => variant.key === key)
                  .map(
                    ([policy, variant]) =>
                      `${id}${policy} consumers=${variant.consumers.size} pending=${!!variant.pending}`
                  )
              );
              log.push(
                `  entry leases=${entry.leases} bytes=${entry.bytes} owners=[${owners.join('; ')}] key=${key.slice(0, 60)}`
              );
            }
          fail(
            `settled: ${cache.memory.bytes}+${state.bindingBytes} bytes over budget ${budget} with ${unpinned} unpinned bodies`
          );
        }
        if (state.artifacts.size) fail('settled: artifact jobs remain');
      }
    } else if (roll < 0.985 && store) {
      if (rng.chance(0.2)) {
        // Another tab invalidated without this tab hearing the broadcast.
        store.gen++;
        store.records.clear();
        foreignInvalidations++;
        log.push('foreign invalidation');
      } else {
        const keys = [...store.records.keys()];
        if (!keys.length) return;
        const key = rng.pick(keys);
        const record = store.records.get(key) as Artifact;
        store.records.set(key, { ...record, bytes: -1 });
        log.push('corrupt record');
      }
    }
    if (stepIndex === disposeAt && !disposed) {
      disposed = true;
      cache.dispose();
      log.push('dispose');
    }
    await ticks(rng.int(0, 6));
  }

  async function quiesce() {
    executor.failures = 0;
    if (store) store.quota = 0;
    for (let round = 0; round < 100; round++) {
      while (executor.pending.length) executor.settle(0, false);
      await vi.advanceTimersByTimeAsync(1000);
      await ticks(50);
      if (!executor.pending.length) {
        await vi.advanceTimersByTimeAsync(1000);
        await ticks(50);
        if (!executor.pending.length) return;
      }
    }
    fail('did not quiesce');
  }

  try {
    for (let i = 0; i < steps; i++) {
      await step(i);
      check(`step ${i}`);
    }
    await quiesce();
    check('quiescent');

    for (const record of leases) {
      if (record.released) continue;
      if (!record.outcome) fail(`lease #${record.n} never settled`);
      const live =
        !disposed && !record.superseded && record.request.priority === 0;
      const error = record.outcome?.ok === false && record.outcome.error;
      if (live && error && (error as Error).name === 'AbortError')
        violations.push(
          `live foreground lease #${record.n} was cancelled (AbortError) although unreleased, current and not disposed [${record.joined ? 'joined an existing pending' : 'own resolution'}]`
        );
      if (
        live &&
        error &&
        (error as Error).name !== 'AbortError' &&
        !injectFailures
      )
        fail(`lease #${record.n} failed without injected failures: ${error}`);
      if (disposed && record.outcome?.ok === false) {
        const name = (record.outcome.error as Error).name;
        if (name !== 'AbortError' && !injectFailures)
          violations.push(
            `disposed lease #${record.n} rejected with ${name}: ${(record.outcome.error as Error).message}`
          );
      }
    }

    for (const record of live()) {
      record.released = true;
      record.lease.release();
    }
    await quiesce();
    check('released');
    const state = internals(cache);
    for (const [key, entry] of entries(cache))
      if (entry.leases !== 0)
        fail(`memory lease leak on ${key.slice(0, 80)}: ${entry.leases}`);
    if (state.artifacts.size)
      fail(`artifact jobs leaked: ${state.artifacts.size}`);
    if (state.scheduler.queue.length || state.scheduler.running)
      fail('scheduler not idle');
    if (state.writes.size) fail('write timers leaked');
    if (!disposed) {
      if (cache.memory.bytes > budget)
        fail(
          `memory ${cache.memory.bytes} over budget ${budget} with no leases`
        );
      if (state.bindings.size > 256) fail('more than 256 bindings retained');
      if (state.bindingBytes >= budget / 2 && state.bindings.size > 0)
        fail(
          `binding bytes ${state.bindingBytes} not trimmed under ${budget / 2}`
        );
      for (const binding of state.bindings.values())
        for (const variant of binding.variants.values())
          if (variant.consumers.size !== 0 || variant.pending)
            fail('variant still has consumers or pending after release');

      // Every request must be preparable again once failures stop.
      const seen = new Map<string, EmailPreparationRequest>();
      for (const record of leases)
        seen.set(
          JSON.stringify([
            record.id,
            record.sourceKey,
            policyTuple(record.request.options),
          ]),
          { ...record.request, priority: 0 }
        );
      const retries = [...seen.values()].slice(-25);
      for (const request of retries) {
        const lease = cache.acquire(request);
        const outcome = lease.promise.then(
          (body) => ({ ok: true as const, body }),
          (error) => ({ ok: false as const, error })
        );
        await quiesce();
        const result = await outcome;
        if (!result.ok)
          fail(
            `retry of ${request.mailboxId}/${request.messageId} failed: ${(result.error as Error)?.message}`
          );
        else if (
          !sameBody(result.body, expectedBody(request.input, request.options))
        )
          fail('retry delivered a body for another request');
        lease.release();
      }
      await quiesce();
      for (const entry of entries(cache).values())
        if (entry.leases !== 0) fail('memory lease leak after retries');
    }

    if (staleNotices && !foreignInvalidations)
      fail('onStaleGeneration without any foreign invalidation');
    if (store) {
      if (store.writesAfterDispose)
        fail(`${store.writesAfterDispose} store writes started after dispose`);
      for (const [key, value] of store.records) {
        const record = value as Artifact;
        if (record.bytes === -1) continue; // injected corruption
        const [mailboxHash, , sourceHash, policyHash] = JSON.parse(key) as [
          string,
          number,
          string,
          string,
        ];
        expect(mailboxHash.startsWith('H:')).toBe(true);
        const [html, replylessHtml, text] = JSON.parse(sourceHash.slice(2));
        const options = JSON.parse(policyHash.slice(2)) as unknown[];
        const expected = {
          html: JSON.stringify([
            JSON.stringify([html, replylessHtml, text]),
            JSON.stringify(options),
          ]),
          kind: 'html',
          hasTable: false,
          hasHiddenContent: false,
        };
        if (
          !sameBody(record.body, expected as PreparedEmailBody) ||
          record.schema !== ARTIFACT_SCHEMA_VERSION ||
          record.bytes !== artifactBytes(record.body)
        )
          fail(`store holds a wrong record for ${key.slice(0, 80)}`);
      }
    }
    if (!disposed) cache.dispose();
    await ticks(20);
  } catch (error) {
    if (!(error instanceof Violation)) violations.push(`threw: ${error}`);
  }
  if (process.env.FUZZ_DEBUG)
    console.log(
      `seed ${seed}: leases=${leases.length} ok=${leases.filter((r) => r.outcome?.ok).length} ready=${leases.filter((r) => r.ready).length} abort=${leases.filter((r) => r.outcome?.ok === false && (r.outcome.error as Error).name === 'AbortError').length} err=${leases.filter((r) => r.outcome?.ok === false && (r.outcome.error as Error).name !== 'AbortError').length} records=${store?.records.size} hits=${store?.hits} stale=${staleNotices} disposed=${disposed} violations=${violations.length} log=${log.length}`
    );
  return { violations, log, staleNotices };
}

// -------------------------------------------------------------------- tests

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.useRealTimers();
});

describe('EmailRenderCache model-based fuzz', () => {
  it('upholds lease, accounting, liveness and persistence invariants', async () => {
    const only = process.env.FUZZ_SEED;
    const seeds = only
      ? [Number(only)]
      : Array.from(
          { length: Number(process.env.FUZZ_SEEDS ?? 150) },
          (_, i) => i + Number(process.env.FUZZ_FROM ?? 1)
        );
    const steps = Number(process.env.FUZZ_STEPS ?? 400);
    const failures: { seed: number; violations: string[]; log: string[] }[] =
      [];
    for (const seed of seeds) {
      const result = await runSeed(seed, steps);
      if (result.violations.length)
        failures.push({ seed, violations: result.violations, log: result.log });
    }
    const categories = new Map<string, number[]>();
    for (const failure of failures)
      for (const violation of failure.violations) {
        const category = violation
          .replace(/#\d+/g, '#N')
          .replace(/step \d+/g, 'step N')
          .replace(/\d{2,}/g, 'N');
        const list = categories.get(category) ?? [];
        list.push(failure.seed);
        categories.set(category, list);
      }
    if (process.env.FUZZ_LOG && failures.length)
      (await import('node:fs')).writeFileSync(
        process.env.FUZZ_LOG,
        failures.map((f) => [...f.violations, ...f.log].join('\n')).join('\n\n')
      );
    if (failures.length) {
      const first = failures[0];
      const summary = [...categories]
        .map(
          ([category, list]) =>
            `  ${list.length}× ${category}\n     seeds: ${[...new Set(list)].slice(0, 10).join(', ')}`
        )
        .join('\n');
      console.error(
        `fuzz: ${failures.length}/${seeds.length} seeds violated invariants\n${summary}\n\nfirst failing seed ${first.seed}: ${first.violations.join(' | ')}\nop log tail:\n${first.log.slice(-60).join('\n')}`
      );
    }
    expect(unhandled).toEqual([]);
    expect(
      [...categories.keys()],
      'see console output for seeds/op logs'
    ).toEqual([]);
  }, 120_000);
});

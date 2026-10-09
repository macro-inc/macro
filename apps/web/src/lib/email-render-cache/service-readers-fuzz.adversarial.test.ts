/**
 * Reader-level fuzz of EmailRenderCache: mounted body readers (modelling
 * createStableEmailMessageBody's acquisition effect, including its AbortError
 * retry budget) plus speculative, prepareThreads-like leases with current or
 * stale sources. Unlike service-fuzz, it judges what a user sees.
 *
 * Every message has one current source at a time, and a source change reaches
 * all of that message's readers in the same batch (no split disagreement), so
 * the known two-reader ping-pong cannot occur. With no injected failures:
 *  - no reader ever shows the error state;
 *  - after quiescence every reader displays exactly its request's body.
 *
 * Reproduce with READER_FUZZ_SEED=<n>; scale with READER_FUZZ_SEEDS/STEPS.
 */
import type { PreparedEmailBody } from '@macro-inc/email-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  EmailPreparationRequest,
  PreparedEmailLease,
} from '../../features/email-message/context/email-preparation';
import type { PreparationExecutor } from './executor';
import { policyTuple, sourceTuple } from './keys';
import { EmailRenderCache } from './service';

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

const expected = (
  input: EmailPreparationRequest['input'],
  options: EmailPreparationRequest['options']
): PreparedEmailBody => ({
  html: JSON.stringify([sourceTuple(input), policyTuple(options)]),
  kind: 'html',
  hasTable: false,
  hasHiddenContent: false,
});

function executor(rng: ReturnType<typeof mulberry32>): PreparationExecutor {
  const later = <T>(value: () => T) =>
    new Promise<T>((resolve) =>
      setTimeout(() => resolve(value()), rng.int(0, 6))
    );
  let disposed = false;
  return {
    hash: (tuple) => later(() => `H:${tuple}`),
    hashSource: (input) => later(() => `S:${sourceTuple(input)}`),
    prepare: (input, options) => {
      if (disposed) return Promise.reject(new Error('disposed'));
      return later(() => expected(input, options));
    },
    dispose() {
      disposed = true;
    },
  };
}

const POLICIES: EmailPreparationRequest['options'][] = [
  {},
  { showQuotedContent: true },
  { images: { remote: 'block' } },
];
const BIG = 'x'.repeat(140 * 1024);

interface Reader {
  n: number;
  message: string;
  policy: number;
  request: EmailPreparationRequest;
  body?: PreparedEmailBody;
  error: boolean;
  pending: boolean;
  aborts: number;
  displayed?: PreparedEmailLease;
  cleanup?: () => void;
  history: string[];
}

async function runSeed(seed: number, steps: number) {
  const rng = mulberry32(seed);
  const cache = new EmailRenderCache({
    memoryBytes: rng.pick([4 * 1024, 64 * 1024, 16 * 1024 * 1024]),
    executor: executor(rng),
  });
  const messages = ['a', 'b', 'c', 'd'];
  const versions = new Map(messages.map((id) => [id, 1]));
  const big = new Set<string>();
  const source = (message: string, version: number) => ({
    html: `<p>${message} v${version}${big.has(message) ? BIG : ''}</p>`,
  });
  const requestFor = (
    message: string,
    policy: number,
    version = versions.get(message)!,
    priority = 0
  ): EmailPreparationRequest => ({
    messageId: message,
    threadId: `t-${message}`,
    mailboxId: 'mailbox',
    input: source(message, version),
    options: POLICIES[policy],
    priority,
  });
  const readers: Reader[] = [];
  const speculative = new Set<PreparedEmailLease>();
  const log: string[] = [`seed ${seed}`];
  const violations: string[] = [];
  let counter = 0;

  function run(reader: Reader) {
    reader.cleanup?.();
    let active = true;
    let lease: PreparedEmailLease | undefined;
    reader.error = false;
    const accept = (body: PreparedEmailBody) => {
      if (!active) {
        lease?.release();
        return;
      }
      if (reader.displayed !== lease) reader.displayed?.release();
      reader.displayed = lease;
      reader.aborts = 0;
      reader.body = body;
      reader.pending = false;
      reader.history.push('accept');
    };
    reader.cleanup = () => {
      active = false;
      if (lease !== reader.displayed) lease?.release();
    };
    try {
      lease = cache.acquire(reader.request);
      if (lease.ready) accept(lease.ready);
      else {
        reader.pending = true;
        lease.promise.then(accept, (error: Error) => {
          if (!active) return;
          reader.pending = false;
          reader.history.push(`reject ${error.name}`);
          if (error.name === 'AbortError' && reader.aborts++ < 3) run(reader);
          else {
            reader.error = true;
            violations.push(
              `reader #${reader.n} ${reader.message}/p${reader.policy} shows the error state (${error.name}: ${error.message}) history=[${reader.history.join(', ')}]`
            );
          }
        });
      }
    } catch (error) {
      reader.error = true;
      violations.push(`reader #${reader.n} acquire threw ${error}`);
    }
  }

  async function step() {
    const roll = rng.next();
    if (roll < 0.2 || !readers.length) {
      const message = rng.pick(messages);
      const policy = rng.int(0, POLICIES.length - 1);
      const reader: Reader = {
        n: ++counter,
        message,
        policy,
        request: requestFor(message, policy),
        error: false,
        pending: false,
        aborts: 0,
        history: [],
      };
      readers.push(reader);
      log.push(`mount #${reader.n} ${message} p${policy}`);
      run(reader);
    } else if (roll < 0.3) {
      const reader = rng.pick(readers);
      readers.splice(readers.indexOf(reader), 1);
      reader.cleanup?.();
      reader.displayed?.release();
      log.push(`unmount #${reader.n}`);
    } else if (roll < 0.42) {
      // A message's source changes; every reader of it updates in one batch.
      const message = rng.pick(messages);
      versions.set(message, versions.get(message)! + 1);
      if (rng.chance(0.15)) {
        if (big.has(message)) big.delete(message);
        else big.add(message);
      }
      log.push(`edit ${message} -> v${versions.get(message)}`);
      for (const reader of readers.filter((r) => r.message === message)) {
        // READER_FUZZ_SPLIT: splits observe the edit at different times.
        if (process.env.READER_FUZZ_SPLIT && rng.chance(0.5)) continue;
        reader.request = requestFor(message, reader.policy);
        run(reader);
      }
    } else if (roll < 0.45 && process.env.READER_FUZZ_SPLIT) {
      for (const reader of readers) {
        const want = requestFor(reader.message, reader.policy);
        if (want.input.html === reader.request.input.html) continue;
        reader.request = want;
        log.push(`catch up #${reader.n}`);
        run(reader);
      }
    } else if (roll < 0.5) {
      const reader = rng.pick(readers);
      reader.policy = (reader.policy + 1) % POLICIES.length;
      reader.request = requestFor(reader.message, reader.policy);
      log.push(`toggle #${reader.n} -> p${reader.policy}`);
      run(reader);
    } else if (roll < 0.7) {
      // prepareThreads-like speculation, sometimes from a stale page.
      const message = rng.pick(messages);
      const current = versions.get(message)!;
      const version = rng.chance(0.3) ? Math.max(1, current - 1) : current;
      const lease = cache.acquire(
        requestFor(
          message,
          rng.int(0, POLICIES.length - 1),
          version,
          rng.int(1, 4)
        )
      );
      speculative.add(lease);
      log.push(`speculate ${message} v${version}`);
      lease.promise
        .catch(() => {})
        .finally(() => {
          if (speculative.delete(lease)) lease.release();
        });
    } else if (roll < 0.78) {
      if (!speculative.size) return;
      const lease = rng.pick([...speculative]);
      speculative.delete(lease);
      lease.release();
      log.push('cancel speculation');
    } else {
      const ms = rng.pick([0, 1, 3, 10]);
      await vi.advanceTimersByTimeAsync(ms);
    }
    for (let i = 0; i < rng.int(0, 4); i++) await Promise.resolve();
  }

  for (let i = 0; i < steps && !violations.length; i++) await step();
  for (let i = 0; i < 50; i++) await vi.advanceTimersByTimeAsync(20);
  if (!violations.length)
    for (const reader of readers) {
      const want = expected(reader.request.input, reader.request.options);
      if (reader.error) continue; // already reported
      if (reader.pending || reader.body?.html !== want.html)
        violations.push(
          `reader #${reader.n} ${reader.message}/p${reader.policy} never displayed its body (pending=${reader.pending}) history=[${reader.history.join(', ')}]`
        );
    }
  for (const reader of readers) {
    reader.cleanup?.();
    reader.displayed?.release();
  }
  for (const lease of speculative) lease.release();
  cache.dispose();
  return { violations, log };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

it('readers with a single current source never see an error and always settle on their body', async () => {
  const only = process.env.READER_FUZZ_SEED;
  const seeds = only
    ? [Number(only)]
    : Array.from(
        { length: Number(process.env.READER_FUZZ_SEEDS ?? 150) },
        (_, i) => i + 1
      );
  const steps = Number(process.env.READER_FUZZ_STEPS ?? 200);
  const failures: { seed: number; violations: string[]; log: string[] }[] = [];
  for (const seed of seeds) {
    const result = await runSeed(seed, steps);
    if (result.violations.length) failures.push({ seed, ...result });
  }
  if (failures.length)
    console.error(
      `${failures.length}/${seeds.length} seeds failed; first seed ${failures[0].seed}:\n${failures[0].violations.join('\n')}\nlog tail:\n${failures[0].log.slice(-40).join('\n')}`
    );
  expect(failures.map((failure) => failure.seed)).toEqual([]);
}, 120_000);

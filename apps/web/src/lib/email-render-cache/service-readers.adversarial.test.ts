/**
 * Round-2 adversarial checks against the EmailRenderCache fixes: per-lease
 * consumers, restart-once, refused speculation, and the body primitive's
 * AbortError retry loop that now depends on them.
 */
import {
  type PreparedEmailBody,
  prepareEmailBody,
} from '@macro-inc/email-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  EmailPreparationRequest,
  PreparedEmailLease,
} from '../../features/email-message/context/email-preparation';
import { directExecutor, type PreparationExecutor } from './executor';
import { EmailRenderCache } from './service';

const base: EmailPreparationRequest = {
  messageId: 'message',
  threadId: 'thread',
  mailboxId: 'mailbox',
  input: { html: '<p>Hello</p>' },
  options: {},
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function spied(overrides: Partial<PreparationExecutor> = {}) {
  return {
    ...directExecutor,
    prepare: vi.fn(directExecutor.prepare),
    hash: vi.fn(directExecutor.hash),
    hashSource: vi.fn(directExecutor.hashSource),
    ...overrides,
  };
}

/**
 * A faithful model of createStableEmailMessageBody's acquisition effect:
 * - the displayed lease is kept until a replacement is accepted;
 * - a failed attempt's lease is released by the effect cleanup;
 * - AbortError re-acquires (setAttempt) up to 3 times, counting only
 *   consecutive aborts (reset on accept), then shows the error/retry UI.
 */
function mountBody(cache: EmailRenderCache, request: EmailPreparationRequest) {
  const state = {
    body: undefined as PreparedEmailBody | undefined,
    error: false,
    pending: false,
    aborts: 0,
    acquisitions: 0,
    displayed: undefined as PreparedEmailLease | undefined,
    dispose() {
      cleanup?.();
      state.displayed?.release();
    },
    retry() {
      run();
    },
  };
  let cleanup: (() => void) | undefined;
  function run() {
    cleanup?.();
    let active = true;
    let lease: PreparedEmailLease | undefined;
    state.error = false;
    state.acquisitions++;
    const accept = (body: PreparedEmailBody) => {
      if (!active) {
        lease?.release();
        return;
      }
      if (state.displayed !== lease) state.displayed?.release();
      state.displayed = lease;
      state.aborts = 0;
      state.body = body;
      state.pending = false;
    };
    cleanup = () => {
      active = false;
      if (lease !== state.displayed) lease?.release();
    };
    try {
      lease = cache.acquire(request);
      if (lease.ready) accept(lease.ready);
      else {
        state.pending = true;
        lease.promise.then(accept, (error: unknown) => {
          if (!active) return;
          state.pending = false;
          if (
            error instanceof DOMException &&
            error.name === 'AbortError' &&
            state.aborts++ < 3
          )
            run(); // setAttempt -> the effect re-runs synchronously
          else {
            // Mirrors the primitive: the cache could not serve this body, so
            // prepare it directly and only error when that fails too.
            lease?.release();
            lease = undefined;
            try {
              accept(prepareEmailBody(request.input, request.options));
            } catch {
              state.error = true;
            }
          }
        });
      }
    } catch {
      state.error = true;
      state.pending = false;
    }
  }
  run();
  return state;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('two foreground readers of one message', () => {
  it('readers whose DTOs disagree on the source both end up showing their own body', async () => {
    // e.g. the same thread open in two splits while one split's query has
    // refetched an edited/re-synced message and the other has not (or a list
    // DTO that omits body_replyless). Each foreground acquire with a changed
    // source rebinds the message and cancels the other reader; the
    // primitive's "acquire again a few times" retry only ping-pongs.
    const cache = new EmailRenderCache({ executor: spied() });
    const older = mountBody(cache, base);
    const newer = mountBody(cache, {
      ...base,
      input: { html: '<p>Hello (edited)</p>' },
    });
    await sleep(100);
    const outcome = (reader: typeof older) => ({
      body: reader.body?.html,
      error: reader.error,
      pending: reader.pending,
    });
    // Both readers asked for a valid body; neither should end in an error.
    expect([outcome(older), outcome(newer)]).toEqual([
      { body: prepareEmailBody(base.input).html, error: false, pending: false },
      {
        body: prepareEmailBody({ html: '<p>Hello (edited)</p>' }).html,
        error: false,
        pending: false,
      },
    ]);
    older.dispose();
    newer.dispose();
    cache.dispose();
  });

  it('holds: once one reader displays, the loser recovers on a manual retry without disturbing the winner', async () => {
    const cache = new EmailRenderCache({ executor: spied() });
    const a = mountBody(cache, base);
    const b = mountBody(cache, {
      ...base,
      input: { html: '<p>Hello (edited)</p>' },
    });
    await sleep(100);
    const loser = a.error ? a : b;
    const winner = a.error ? b : a;
    // Precondition (the bug above): one reader exhausted its retries.
    if (!loser.error) return;
    const before = winner.acquisitions;
    loser.retry();
    await sleep(100);
    // The winner already displayed its body; a retry elsewhere must not cost
    // it its body or flip it into the error state.
    expect({
      winnerError: winner.error,
      winnerReacquired: winner.acquisitions - before,
      loserError: loser.error,
    }).toEqual({ winnerError: false, winnerReacquired: 0, loserError: false });
    a.dispose();
    b.dispose();
    cache.dispose();
  });
});

describe('restart-once and refused speculation (these hold)', () => {
  it('holds: refused speculation returns an inert cancelled lease and leaves the reader untouched', async () => {
    const cache = new EmailRenderCache({ executor: spied() });
    const reader = cache.acquire(base);
    await reader.promise;
    const before = cache.estimatedBytes;
    const refused = cache.acquire({
      ...base,
      input: { html: '<p>other</p>' },
      priority: 2,
    });
    await expect(refused.promise).rejects.toMatchObject({ name: 'AbortError' });
    refused.promote();
    refused.release();
    refused.release();
    expect(cache.estimatedBytes).toBe(before);
    // Same source joins rather than being refused.
    const joined = cache.acquire({ ...base, priority: 2 });
    expect(joined.ready).toBeDefined();
    joined.release();
    reader.release();
    cache.dispose();
  });

  it('holds: two live consumers of one cancelled pending restart a single shared job', async () => {
    const executor = spied();
    const cache = new EmailRenderCache({ executor });
    const big = { ...base, input: { html: `<p>${'x'.repeat(300_000)}</p>` } };
    // Speculation admits nothing over 256 KiB; both foreground leases join
    // the cancelled pending in the same tick and must share one restart.
    const speculative = cache.acquire({ ...big, priority: 3 });
    const first = cache.acquire(big);
    const second = cache.acquire(big);
    const [a, b] = await Promise.all([first.promise, second.promise]);
    expect(a).toBe(b);
    expect(executor.prepare).toHaveBeenCalledTimes(1);
    await expect(speculative.promise).resolves.toBe(a);
    for (const lease of [speculative, first, second]) lease.release();
    cache.dispose();
  });
});

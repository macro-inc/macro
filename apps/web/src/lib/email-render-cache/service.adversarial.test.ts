/**
 * Adversarial, deterministic reproductions against EmailRenderCache.
 * Every `it` here encodes a contract the README/consumers rely on; a failure is
 * a bug in the cache, not in the test.
 */
import { prepareEmailBody } from '@macro-inc/email-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailPreparationRequest } from '../../features/email-message/context/email-preparation';
import { directExecutor, type PreparationExecutor } from './executor';
import { EmailRenderCache } from './service';
import type { ArtifactStore } from './store';

const base: EmailPreparationRequest = {
  messageId: 'message',
  threadId: 'thread',
  mailboxId: 'mailbox',
  input: { html: '<p>Hello</p>' },
  options: {},
};

const flush = async (turns = 50) => {
  for (let i = 0; i < turns; i++) await Promise.resolve();
};

function spied(overrides: Partial<PreparationExecutor> = {}) {
  const executor = {
    ...directExecutor,
    prepare: vi.fn(directExecutor.prepare),
    hash: vi.fn(directExecutor.hash),
    hashSource: vi.fn(directExecutor.hashSource),
    ...overrides,
  };
  return executor;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('foreground leases are never cancelled by a doomed speculative pending', () => {
  // stable-email-message-body treats AbortError as "superseded": it clears the
  // pending flag and shows neither a body nor an error/retry. A spurious
  // AbortError on a live foreground lease therefore leaves a blank body.
  it('oversized speculation acquired in the same tick as the foreground request', async () => {
    const cache = new EmailRenderCache({ executor: spied() });
    const big = {
      ...base,
      input: { html: `<p>${'x'.repeat(256 * 1024)}</p>` },
    };
    // e.g. a preparation window and the body effect run in one Solid batch.
    const speculative = cache.acquire({ ...big, priority: 2 });
    const foreground = cache.acquire(big);
    // The foreground lease restarts the job its speculative peer's admission
    // check cancelled; the still-live speculative lease shares the result.
    await expect(foreground.promise).resolves.toEqual(
      prepareEmailBody(big.input, big.options)
    );
    await expect(speculative.promise).resolves.toEqual(
      prepareEmailBody(big.input, big.options)
    );
    speculative.release();
    foreground.release();
    cache.dispose();
  });

  it('speculation rejected by the 32-job cap acquired in the same tick as the foreground request', async () => {
    const gate = Promise.withResolvers<string>();
    let first = true;
    const executor = spied({
      hashSource: vi.fn(async (input) => {
        if (first) {
          first = false;
          return await gate.promise; // keeps the single parser busy
        }
        return await directExecutor.hashSource(input);
      }),
    });
    const cache = new EmailRenderCache({ executor });
    const blocker = cache.acquire({ ...base, messageId: 'blocker' });
    await flush();
    const queued = Array.from({ length: 32 }, (_, index) =>
      cache.acquire({
        ...base,
        messageId: `queued-${index}`,
        input: { html: `<p>${index}</p>` },
        priority: 3,
      })
    );
    const target = {
      ...base,
      messageId: 'target',
      input: { html: '<p>T</p>' },
    };
    const speculative = cache.acquire({ ...target, priority: 3 });
    const foreground = cache.acquire(target);
    gate.resolve(await directExecutor.hashSource(base.input));
    // Same mechanism, triggered by the cap: the foreground restarts the job.
    await expect(foreground.promise).resolves.toEqual(
      prepareEmailBody(target.input, target.options)
    );
    await expect(speculative.promise).resolves.toEqual(
      prepareEmailBody(target.input, target.options)
    );
    for (const lease of [blocker, ...queued, speculative, foreground])
      lease.release();
    cache.dispose();
  });

  it('re-acquiring a variant just after its released preparation was cancelled', async () => {
    // Scan the microtask offset between "prepare finished for a released
    // lease" and a re-acquire of the same variant. Any offset where the new,
    // live lease gets AbortError is a bug: nothing cancelled it.
    const failures: number[] = [];
    for (let offset = 0; offset < 30; offset++) {
      const parse =
        Promise.withResolvers<ReturnType<typeof prepareEmailBody>>();
      const executor = spied({ prepare: vi.fn(() => parse.promise) });
      const cache = new EmailRenderCache({ executor });
      const first = cache.acquire(base);
      void first.promise.catch(() => {});
      await vi.waitFor(() => expect(executor.prepare).toHaveBeenCalled());
      first.release();
      parse.resolve(prepareEmailBody(base.input));
      for (let i = 0; i < offset; i++) await Promise.resolve();
      const second = cache.acquire(base);
      vi.mocked(executor.prepare).mockImplementation(directExecutor.prepare);
      try {
        await second.promise;
      } catch (error) {
        if ((error as Error).name === 'AbortError') failures.push(offset);
      }
      second.release();
      cache.dispose();
    }
    // Regression: variant.pending is cleared asynchronously (finishVariant), so an
    // acquire inside that window joins an already-rejected promise.
    expect(failures).toEqual([]);
  });
});

describe('priority bookkeeping', () => {
  it('a released foreground consumer does not turn later speculation into foreground work', async () => {
    const executor = spied();
    const cache = new EmailRenderCache({ executor });
    // User opens a message then navigates away before it finishes.
    const opened = cache.acquire(base);
    void opened.promise.catch(() => {});
    opened.release();
    await flush();
    // Later, the preparation window speculatively prepares that message.
    const speculative = cache.acquire({ ...base, priority: 3 });
    await speculative.promise;
    // Regression: variant.priority is a sticky Math.min never raised
    // again when the foreground consumer leaves, so speculative work is sent
    // to the executor as priority 0 (main-thread parse in production).
    expect(executor.prepare).toHaveBeenLastCalledWith(
      base.input,
      base.options,
      3
    );
    speculative.release();
    cache.dispose();
  });

  it('a released foreground consumer does not let oversized speculation bypass the 256 KiB skip', async () => {
    const executor = spied();
    const cache = new EmailRenderCache({ executor });
    const big = {
      ...base,
      input: { html: `<p>${'x'.repeat(256 * 1024)}</p>` },
    };
    const opened = cache.acquire(big);
    void opened.promise.catch(() => {});
    opened.release();
    await flush();
    const speculative = cache.acquire({ ...big, priority: 3 });
    // README: "Speculation ... skips inputs over 256 KiB".
    await expect(speculative.promise).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(executor.prepare).not.toHaveBeenCalled();
    speculative.release();
    cache.dispose();
  });

  it('stale foreground priority does not queue speculation ahead of a real foreground request', async () => {
    const gate = Promise.withResolvers<string>();
    let first = true;
    const order: string[] = [];
    const executor = spied({
      hashSource: vi.fn(async (input) => {
        if (first) {
          first = false;
          return await gate.promise;
        }
        return await directExecutor.hashSource(input);
      }),
      prepare: vi.fn(async (input, options) => {
        order.push(input.html ?? '');
        return prepareEmailBody(input, options);
      }),
    });
    const cache = new EmailRenderCache({ executor });
    const neighbor = {
      ...base,
      messageId: 'neighbor',
      input: { html: 'neighbor' },
    };
    // Neighbor was opened and abandoned earlier.
    const abandoned = cache.acquire(neighbor);
    void abandoned.promise.catch(() => {});
    abandoned.release();
    await flush();
    const blocker = cache.acquire({ ...base, messageId: 'blocker' });
    await flush();
    const speculative = cache.acquire({ ...neighbor, priority: 3 });
    const foreground = cache.acquire({
      ...base,
      messageId: 'open',
      input: { html: 'open' },
    });
    gate.resolve(await directExecutor.hashSource(base.input));
    await Promise.all([speculative.promise, foreground.promise]);
    expect(order.indexOf('open')).toBeLessThan(order.indexOf('neighbor'));
    for (const lease of [blocker, speculative, foreground]) lease.release();
    cache.dispose();
  });

  it('cancelled speculative jobs do not occupy the 32-preparation cap', async () => {
    const gate = Promise.withResolvers<string>();
    let first = true;
    const executor = spied({
      hashSource: vi.fn(async (input) => {
        if (first) {
          first = false;
          return await gate.promise;
        }
        return await directExecutor.hashSource(input);
      }),
    });
    const cache = new EmailRenderCache({ executor });
    const blocker = cache.acquire({ ...base, messageId: 'blocker' });
    await flush();
    // A burst of hover/neighbor speculation that is immediately abandoned.
    for (let index = 0; index < 32; index++) {
      const lease = cache.acquire({
        ...base,
        messageId: `abandoned-${index}`,
        input: { html: `<p>${index}</p>` },
        priority: 3,
      });
      void lease.promise.catch(() => {});
      lease.release();
    }
    const live = cache.acquire({
      ...base,
      messageId: 'live',
      input: { html: '<p>live</p>' },
      priority: 3,
    });
    gate.resolve(await directExecutor.hashSource(base.input));
    // Regression: scheduler.ts counts dead jobs, so the only live
    // speculative preparation is refused.
    await expect(live.promise).resolves.toMatchObject({ kind: 'html' });
    blocker.release();
    live.release();
    cache.dispose();
  });
});

describe('retryability', () => {
  it('a transient source-hash failure on a previously keyed variant is retryable', async () => {
    let failHash = false;
    let failPrepare = true;
    const executor = spied({
      hashSource: vi.fn(async (input) => {
        if (failHash) {
          failHash = false;
          throw new Error('transient hash failure');
        }
        return await directExecutor.hashSource(input);
      }),
      prepare: vi.fn(async (input, options) => {
        if (failPrepare) {
          failPrepare = false;
          throw new Error('transient prepare failure');
        }
        return prepareEmailBody(input, options);
      }),
    });
    const cache = new EmailRenderCache({ executor });
    // 1. First attempt hashes (variant gets its key) then fails to prepare.
    const first = cache.acquire(base);
    await expect(first.promise).rejects.toThrow('transient prepare failure');
    first.release();
    // 2. Another policy variant of the same message is abandoned before
    //    hashing; its cleanup drops the shared binding.sourceHash.
    const quoted = cache.acquire({
      ...base,
      options: { showQuotedContent: true },
      priority: 2,
    });
    void quoted.promise.catch(() => {});
    quoted.release();
    await flush();
    // 3. Retry hits one transient hash failure.
    failHash = true;
    const second = cache.acquire(base);
    await expect(second.promise).rejects.toThrow('transient hash failure');
    second.release();
    await flush();
    // 4. Every executor call now succeeds; the next retry must too.
    const third = cache.acquire(base);
    // Regression: finishVariant only clears binding.sourceHash when the variant has no
    // key, so the rejected hash promise is reused forever.
    await expect(third.promise).resolves.toEqual(prepareEmailBody(base.input));
    third.release();
    cache.dispose();
  });
});

describe('persistence', () => {
  it('a slow first storage open does not disable persistence for the whole session', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const records = new Map<string, unknown>();
    const store: ArtifactStore = {
      generation: async () => 0,
      read: vi.fn(async (key: string) => records.get(key)),
      write: vi.fn(async (_generation, artifact) => {
        records.set(artifact.key, artifact);
        return true;
      }),
      remove: vi.fn(async () => {}),
      invalidate: vi.fn(async () => {}),
      close: vi.fn(),
    };
    // session-runtime's store() first awaits the previous session's clear
    // (waitForInvalidation), which can easily take longer than 150 ms.
    const cache = new EmailRenderCache({
      executor: spied(),
      store: () =>
        new Promise<ArtifactStore>((resolve) =>
          setTimeout(() => resolve(store), 200)
        ),
    });
    cache.initializeStorage();
    await vi.advanceTimersByTimeAsync(5_000);
    // Long after storage became available, the user opens a message.
    const lease = cache.acquire(base);
    await vi.advanceTimersByTimeAsync(1_000);
    await lease.promise;
    await vi.advanceTimersByTimeAsync(1_000);
    // Regression: openStorage() caches the deadline's `undefined`
    // so the service never reads or writes the persistent tier.
    expect(store.read).toHaveBeenCalled();
    expect(store.write).toHaveBeenCalled();
    lease.release();
    cache.dispose();
  });
});

describe('disposal', () => {
  it('rejects a lease with AbortError, not the executor shutdown error, when disposed mid-preparation', async () => {
    // Production executor with a worker that never answers: a foreground body
    // over 512 KiB of source is prepared in the worker.
    class SilentWorker {
      onmessage?: unknown;
      onerror?: unknown;
      onmessageerror?: unknown;
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', SilentWorker);
    try {
      const { createPreparationExecutor } = await import('./executor');
      const executor = createPreparationExecutor();
      const prepare = vi.spyOn(executor, 'prepare');
      const cache = new EmailRenderCache({ executor });
      const large = {
        ...base,
        input: {
          html: `<p>${'x'.repeat(300 * 1024)}</p>`,
          text: 'y'.repeat(1024),
        },
      };
      const lease = cache.acquire(large);
      await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
      cache.dispose();
      // Regression: receive() rethrows whatever the shared
      // pending rejected with; only success is mapped to AbortError. The
      // body primitive shows its error/retry UI for any non-AbortError.
      await expect(lease.promise).rejects.toMatchObject({ name: 'AbortError' });
      lease.release();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('bounds (these hold)', () => {
  it('keeps at most 256 idle bindings and 8 idle variants, never dropping leased ones', async () => {
    const cache = new EmailRenderCache({ executor: spied() });
    const internals = cache as unknown as {
      bindings: Map<string, { variants: Map<string, unknown> }>;
      bindingBytes: number;
    };
    const held = cache.acquire({ ...base, messageId: 'held' });
    await held.promise;
    for (let index = 0; index < 600; index++) {
      const lease = cache.acquire({
        ...base,
        messageId: `m${index}`,
        input: { html: `<p>${index}</p>` },
      });
      await lease.promise;
      lease.release();
    }
    expect(internals.bindings.size).toBeLessThanOrEqual(256);
    expect(internals.bindings.has(JSON.stringify(['mailbox', 'held']))).toBe(
      true
    );
    const policies = Array.from({ length: 12 }, (_, index) => ({
      images: { remote: 'allow' as const, proxyUrl: `https://p${index}/` },
    }));
    const pinned = cache.acquire({ ...base, options: policies[0] });
    await pinned.promise;
    for (const options of policies.slice(1)) {
      const lease = cache.acquire({ ...base, options });
      await lease.promise;
      lease.release();
    }
    const variants = internals.bindings.get(
      JSON.stringify(['mailbox', 'message'])
    )!.variants;
    expect(variants.size).toBeLessThanOrEqual(8);
    // The leased variant survives and is still a synchronous hit.
    const again = cache.acquire({ ...base, options: policies[0] });
    expect(again.ready).toBeDefined();
    for (const lease of [held, pinned, again]) lease.release();
    expect(cache.memory.bytes).toBeLessThanOrEqual(cache.memory.budget);
    cache.dispose();
    expect(cache.estimatedBytes).toBe(0);
  });
});

describe('storage failures are never mail failures', () => {
  it('a store whose read() throws synchronously still delivers the body (robustness)', async () => {
    // openStorage() explicitly tolerates adapters that "throw before returning
    // a promise"; load() does not (service.ts load: storageDeadline(store.read(key))).
    // The shipped IndexedDbArtifacts methods are async, so this needs a custom
    // or future adapter.
    const store: ArtifactStore = {
      generation: async () => 0,
      read: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      write: vi.fn(async () => true),
      remove: vi.fn(async () => {}),
      invalidate: vi.fn(async () => {}),
      close: vi.fn(),
    };
    const cache = new EmailRenderCache({
      executor: spied(),
      store: async () => store,
    });
    cache.initializeStorage();
    await flush();
    const lease = cache.acquire(base);
    await expect(lease.promise).resolves.toEqual(prepareEmailBody(base.input));
    lease.release();
    cache.dispose();
  });
});

describe('memory budget', () => {
  it('trims an unretained body published while only failed leases remain (low)', async () => {
    let attempt = 0;
    const parse = Promise.withResolvers<ReturnType<typeof prepareEmailBody>>();
    const executor = spied({
      prepare: vi.fn(async () => {
        if (attempt++ === 0) throw new Error('transient prepare failure');
        return await parse.promise;
      }),
    });
    const cache = new EmailRenderCache({ executor, memoryBytes: 64 });
    // A body view whose preparation failed keeps its lease (error/retry UI).
    const failed = cache.acquire(base);
    await expect(failed.promise).rejects.toThrow('transient');
    // Another consumer starts a retry and goes away before it finishes.
    const retry = cache.acquire(base);
    void retry.promise.catch(() => {});
    await vi.waitFor(() => expect(executor.prepare).toHaveBeenCalledTimes(2));
    retry.release();
    parse.resolve(prepareEmailBody(base.input));
    await flush();
    // Nothing holds the published body, yet nothing trims it: finishVariant
    // only trims when the variant has no consumers, and the
    // failed lease still counts as one.
    expect(cache.memory.bytes).toBeLessThanOrEqual(64);
    failed.release();
    cache.dispose();
  });
});

describe('speculation alone', () => {
  it('is still cancelled when oversized, even after its one restart', async () => {
    const cache = new EmailRenderCache({ executor: spied() });
    const big = {
      ...base,
      messageId: 'alone',
      input: { html: `<p>${'x'.repeat(256 * 1024)}</p>` },
    };
    const speculative = cache.acquire({ ...big, priority: 2 });
    await expect(speculative.promise).rejects.toMatchObject({
      name: 'AbortError',
    });
    speculative.release();
    cache.dispose();
  });
});

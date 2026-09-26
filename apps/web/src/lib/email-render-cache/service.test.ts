import { readdirSync, readFileSync } from 'node:fs';
import { prepareEmailBody } from '@macro-inc/email-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { EmailPreparationRequest } from '../../features/email-message/context/email-preparation';
import { directExecutor } from './executor';
import { policyTuple, sourceTuple } from './keys';
import { EmailRenderCache } from './service';
import type { ArtifactStore } from './store';

const request: EmailPreparationRequest = {
  messageId: 'message',
  threadId: 'thread',
  mailboxId: 'mailbox',
  input: { html: '<p>Hello</p><div class="macro_quote">Quoted</div>' },
  options: {},
};

function setup(
  options: ConstructorParameters<typeof EmailRenderCache>[0] = {}
) {
  const prepare = vi.fn(directExecutor.prepare);
  const hash = vi.fn(directExecutor.hash);
  const hashSource = vi.fn(directExecutor.hashSource);
  const cache = new EmailRenderCache({
    ...options,
    executor: { ...directExecutor, prepare, hash, hashSource },
  });
  return { cache, prepare, hash, hashSource };
}

describe('prepared email cache', () => {
  it('initializes storage once ahead of requests without hashing or preparing bodies', async () => {
    const generation = Promise.withResolvers<number>();
    const store: ArtifactStore = {
      generation: vi.fn(() => generation.promise),
      read: vi.fn(async () => undefined),
      write: vi.fn(),
      remove: vi.fn(),
      invalidate: vi.fn(),
      close: vi.fn(),
    };
    const open = vi.fn(async () => store);
    const { cache, prepare, hashSource } = setup({ store: open });
    cache.initializeStorage();
    cache.initializeStorage();
    await vi.waitFor(() => expect(store.generation).toHaveBeenCalledOnce());
    expect(open).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
    expect(hashSource).not.toHaveBeenCalled();
    expect(store.read).not.toHaveBeenCalled();
    generation.resolve(4);
    const lease = cache.acquire(request);
    await lease.promise;
    expect(open).toHaveBeenCalledOnce();
    expect(store.generation).toHaveBeenCalledOnce();
    lease.release();
    cache.dispose();
  });
  it('promotes an in-flight speculative lookup before choosing its preparation executor', async () => {
    const lookup = Promise.withResolvers<undefined>();
    const store: ArtifactStore = {
      generation: async () => 0,
      read: vi.fn(() => lookup.promise),
      write: vi.fn(),
      remove: vi.fn(),
      invalidate: vi.fn(),
      close: vi.fn(),
    };
    const { cache, prepare, hashSource } = setup({ store: async () => store });
    const speculative = cache.acquire({ ...request, priority: 2 });
    await vi.waitFor(() => expect(store.read).toHaveBeenCalledOnce());
    const foreground = cache.acquire(request);
    speculative.release();
    lookup.resolve(undefined);
    expect(await foreground.promise).toEqual(prepareEmailBody(request.input));
    expect(hashSource).toHaveBeenCalledExactlyOnceWith(request.input, 2);
    expect(prepare).toHaveBeenCalledExactlyOnceWith(
      request.input,
      request.options,
      0
    );
    foreground.release();
    cache.dispose();
  });
  it('releases over-budget source tuples after abandoned hashing completes', async () => {
    const hash = Promise.withResolvers<string>();
    const cache = new EmailRenderCache({
      memoryBytes: 1024,
      executor: { ...directExecutor, hashSource: () => hash.promise },
    });
    const lease = cache.acquire({
      ...request,
      input: { html: 'x'.repeat(2000) },
    });
    await Promise.resolve();
    lease.release();
    hash.resolve('a'.repeat(64));
    await expect(lease.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(cache.estimatedBytes).toBe(0);
    cache.dispose();
  });
  it('renders through denied storage and bounds quota recovery to one retry', async () => {
    const denied = setup({
      store: () => {
        throw new Error('Storage unavailable');
      },
    });
    const unavailable = denied.cache.acquire(request);
    expect(await unavailable.promise).toEqual(prepareEmailBody(request.input));
    unavailable.release();
    denied.cache.dispose();
    const write = vi.fn(async () => {
      throw new DOMException('Quota', 'QuotaExceededError');
    });
    const evict = vi.fn(async () => {});
    const store: ArtifactStore = {
      generation: async () => 0,
      read: async () => undefined,
      write,
      evict,
      remove: vi.fn(),
      invalidate: vi.fn(),
      close: vi.fn(),
    };
    const { cache } = setup({ store: async () => store });
    const lease = cache.acquire(request);
    expect(await lease.promise).toEqual(prepareEmailBody(request.input));
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(evict).toHaveBeenCalledTimes(1);
    const next = cache.acquire({
      ...request,
      input: { html: 'Different body' },
    });
    await next.promise;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(write).toHaveBeenCalledTimes(2);
    lease.release();
    next.release();
    cache.dispose();
  });
  it('frames source and policy inputs without merging absent, empty, or distinct flags', () => {
    expect(sourceTuple({})).not.toBe(sourceTuple({ html: '' }));
    expect(sourceTuple({ html: 'a', text: 'b' })).not.toBe(
      sourceTuple({ html: 'ab' })
    );
    expect(policyTuple({ showFullContent: true })).not.toBe(
      policyTuple({ showQuotedContent: true })
    );
    expect(policyTuple({})).toBe(
      policyTuple({ showFullContent: false, images: { remote: 'allow' } })
    );
    expect(
      policyTuple({ images: { remote: 'allow', proxyUrl: 'https://one/' } })
    ).not.toBe(
      policyTuple({ images: { remote: 'allow', proxyUrl: 'https://two/' } })
    );
  });

  it('reuses a stable value and avoids hashing equal fields in new DTOs', async () => {
    const { cache, prepare, hash, hashSource } = setup();
    const first = cache.acquire(request);
    const body = await first.promise;
    first.release();
    const hashes = hash.mock.calls.length;
    const second = cache.acquire({
      ...request,
      input: { ...request.input },
      options: {},
    });
    expect(second.ready).toBe(body);
    expect(await second.promise).toBe(body);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(hash).toHaveBeenCalledTimes(hashes);
    expect(hashSource).toHaveBeenCalledTimes(1);
    second.release();
    cache.dispose();
  });

  it('deduplicates concurrent splits and does not cancel the remaining lease', async () => {
    const { cache, prepare } = setup();
    const first = cache.acquire(request);
    const second = cache.acquire(request);
    first.release();
    await expect(first.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(await second.promise).toEqual(prepareEmailBody(request.input));
    expect(prepare).toHaveBeenCalledTimes(1);
    second.release();
    cache.dispose();
  });

  it('deduplicates artifacts across message identities but keeps mailbox boundaries', async () => {
    const { cache, prepare } = setup();
    const first = cache.acquire(request);
    const second = cache.acquire({ ...request, messageId: 'another' });
    expect(await first.promise).toBe(await second.promise);
    expect(prepare).toHaveBeenCalledTimes(1);
    const otherMailbox = cache.acquire({ ...request, mailboxId: 'another' });
    await otherMailbox.promise;
    expect(prepare).toHaveBeenCalledTimes(2);
    first.release();
    second.release();
    otherMailbox.release();
    cache.dispose();
  });

  it('rejects stale source and disposed results', async () => {
    const { cache } = setup();
    const old = cache.acquire(request);
    const current = cache.acquire({ ...request, input: { html: 'new' } });
    await expect(old.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect((await current.promise).html).toContain('new');
    const late = cache.acquire({ ...request, messageId: 'late' });
    cache.dispose();
    await expect(late.promise).rejects.toMatchObject({ name: 'AbortError' });
    old.release();
    current.release();
    late.release();
  });

  it('uses a new variant for changed quotes, replyless input and image policy', async () => {
    const { cache, prepare } = setup();
    for (const value of [
      request,
      { ...request, options: { showQuotedContent: true } },
      { ...request, options: { images: { remote: 'block' as const } } },
      {
        ...request,
        input: { ...request.input, replylessHtml: '<p>Changed</p>' },
      },
    ]) {
      const lease = cache.acquire(value);
      expect(await lease.promise).toEqual(
        prepareEmailBody(value.input, value.options)
      );
      lease.release();
    }
    expect(prepare).toHaveBeenCalledTimes(4);
    cache.dispose();
  });

  it('pins active artifacts and returns below budget on release', async () => {
    const { cache } = setup({ memoryBytes: 128 });
    const lease = cache.acquire(request);
    await lease.promise;
    expect(cache.memory.bytes).toBeGreaterThan(128);
    lease.release();
    expect(cache.memory.bytes).toBeLessThanOrEqual(128);
    cache.dispose();
  });

  it('uses a validated persistent artifact after restarting without preparation', async () => {
    const records = new Map<string, unknown>();
    const store: ArtifactStore = {
      generation: async () => 4,
      read: async (key) => records.get(key),
      write: async (generation, artifact) => {
        if (generation === 4) records.set(artifact.key, artifact);
      },
      remove: async (key) => {
        records.delete(key);
      },
      invalidate: vi.fn(),
      close: vi.fn(),
    };
    const first = setup({ store: async () => store });
    const lease = first.cache.acquire(request);
    const body = await lease.promise;
    await new Promise((resolve) => setTimeout(resolve, 5));
    lease.release();
    first.cache.dispose();
    expect(records.size).toBe(1);
    const second = setup({ store: async () => store });
    const persisted = second.cache.acquire(request);
    expect(await persisted.promise).toEqual(body);
    expect(second.prepare).not.toHaveBeenCalled();
    persisted.release();
    second.cache.dispose();
    const record = [...records.values()][0] as { version: number };
    record.version = -1;
    const third = setup({ store: async () => store });
    const outdated = third.cache.acquire(request);
    expect(await outdated.promise).toEqual(body);
    expect(third.prepare).toHaveBeenCalledTimes(1);
    outdated.release();
    third.cache.dispose();
  });

  it('allows retry after an executor failure and skips oversized speculation', async () => {
    const prepare = vi
      .fn(directExecutor.prepare)
      .mockRejectedValueOnce(new Error('Transient failure'));
    const cache = new EmailRenderCache({
      executor: { ...directExecutor, prepare },
    });
    const failed = cache.acquire(request);
    await expect(failed.promise).rejects.toThrow('Transient failure');
    failed.release();
    const retry = cache.acquire(request);
    expect(await retry.promise).toEqual(prepareEmailBody(request.input));
    const oversized = cache.acquire({
      ...request,
      messageId: 'large',
      priority: 3,
      input: { html: 'x'.repeat(256 * 1024) },
    });
    await expect(oversized.promise).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(prepare).toHaveBeenCalledTimes(2);
    const foreground = cache.acquire({
      ...request,
      messageId: 'large',
      input: { html: 'x'.repeat(256 * 1024) },
    });
    await foreground.promise;
    expect(prepare).toHaveBeenCalledTimes(3);
    retry.release();
    oversized.release();
    foreground.release();
    cache.dispose();
  });

  it('falls back from corrupt and hanging storage without a late replacement', async () => {
    let resolveDisk!: (value: unknown) => void;
    const store: ArtifactStore = {
      generation: async () => 0,
      read: () =>
        new Promise((resolve) => {
          resolveDisk = resolve;
        }),
      write: vi.fn(),
      remove: vi.fn(),
      invalidate: vi.fn(),
      close: vi.fn(),
    };
    const { cache, prepare } = setup({ store: async () => store });
    const lease = cache.acquire(request);
    const body = await lease.promise;
    resolveDisk({ body: { html: 'wrong' } });
    expect(cache.acquire(request).ready).toBe(body);
    expect(prepare).toHaveBeenCalledTimes(1);
    cache.dispose();
    lease.release();
  });

  it('matches direct preparation for every renderer HTML fixture', async () => {
    const fixtures = new URL(
      '../../../../../packages/email-renderer/tests/fixtures/',
      import.meta.url
    );
    const { cache } = setup();
    const filenames = readdirSync(fixtures).filter((name) =>
      name.endsWith('.json')
    );
    expect(filenames.length).toBeGreaterThan(0);
    for (const filename of filenames) {
      const input = JSON.parse(
        readFileSync(new URL(filename, fixtures), 'utf8')
      );
      for (const options of [
        {},
        { showFullContent: true },
        { showQuotedContent: true },
        { images: { remote: 'block' as const } },
      ]) {
        const lease = cache.acquire({
          ...request,
          messageId: filename,
          input,
          options,
        });
        expect(await lease.promise).toEqual(prepareEmailBody(input, options));
        lease.release();
      }
    }
    cache.dispose();
  });
});

import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheChangeListener, CacheHost } from '@graphql-cache/host/types';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { parseCacheRevision } from '@graphql-cache/protocol';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { CombinedError } from '@urql/core';
import { createEffect, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createContactReferenceSource } from './reference-query';
import type { ContactReferenceReader } from './reference-reader';
import type { ContactReferenceResolution } from './references';

const checkpoint = vi.hoisted(() => vi.fn());
vi.mock('./backfill', () => ({ loadContactCheckpoint: checkpoint }));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactReferencePage: vi.fn(),
  fetchContactDirectoryPage: vi.fn(),
  fetchContactDirectoryByIds: vi.fn(),
}));
const GENERATION = '00000000-0000-4000-8000-000000000001';
const person = {
  userId: 'macro|sam@example.com',
  email: 'sam@example.com',
  name: 'Sam',
};
const result = (): ContactReferenceResolution => ({
  matches: [{ complete: true, people: [person] }],
  source: 'server',
  offline: false,
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('owns only the current requested labels and releases its query history', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const [label, setLabel] = createSignal('first');
  const reader = vi
    .fn<ContactReferenceReader>()
    .mockImplementation(async () => result());
  let source: ReturnType<typeof createContactReferenceSource> | undefined;
  let committed = Promise.withResolvers<void>();
  function Harness() {
    const current = createContactReferenceSource(
      () => ({ userId: 'viewer' }),
      () => ({
        labels: [label()],
        matching: 'exact',
        excludeSecondaryInboxes: false,
      }),
      () => true,
      reader
    );
    source = current;
    createEffect(() => {
      if (current.ready()) committed.resolve();
    });
    return null;
  }
  const view = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(0);
  await committed.promise;
  for (let index = 0; index < 20; index++) {
    committed = Promise.withResolvers<void>();
    setLabel(`query-${index}`);
    expect(source!.lookup('first')).toBeUndefined();
    await vi.runOnlyPendingTimersAsync();
    await committed.promise;
    expect(source!.lookup(`query-${index}`)).toEqual([person]);
    expect(client.getQueryCache().getAll()).toHaveLength(1);
  }
  reader.mockRejectedValue(new CombinedError({ graphQLErrors: ['Forbidden'] }));
  await source!.retry();
  expect(source!.lookup(label())).toBeUndefined();
  expect(source!.data()).toBeUndefined();
  expect(label()).toBe('query-19');
  view.unmount();
  await vi.runOnlyPendingTimersAsync();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  client.clear();
});

it('fences a late account result and serializes the replacement behind physical completion', async () => {
  const client = new QueryClient();
  const [viewer, setViewer] = createSignal('first');
  const entered = Promise.withResolvers<void>();
  const previous = Promise.withResolvers<ContactReferenceResolution>();
  const current = Promise.withResolvers<void>();
  const reader = vi
    .fn<ContactReferenceReader>()
    .mockImplementation(async (id) => {
      if (id === 'first') {
        entered.resolve();
        return previous.promise;
      }
      return {
        ...result(),
        matches: [{ complete: true, people: [{ ...person, name: 'Current' }] }],
      };
    });
  let source: ReturnType<typeof createContactReferenceSource> | undefined;
  function Harness() {
    const owned = createContactReferenceSource(
      () => ({ userId: viewer() }),
      () => ({
        labels: ['Sam'],
        matching: 'exact',
        excludeSecondaryInboxes: false,
      }),
      () => true,
      reader
    );
    source = owned;
    createEffect(() => {
      if (owned.lookup('Sam')?.[0].name === 'Current') current.resolve();
    });
    return null;
  }
  const view = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await entered.promise;
  setViewer('second');
  expect(source!.lookup('Sam')).toBeUndefined();
  expect(reader.mock.calls[0][3].aborted).toBe(true);
  previous.resolve(result());
  await current.promise;
  expect(source!.lookup('Sam')?.[0].name).toBe('Current');
  expect(reader).toHaveBeenCalledTimes(2);
  view.unmount();
  client.clear();
});

it.each(['completion', 'context'] as const)(
  'wakes incomplete evidence only when %s becomes ready',
  async (transition) => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const client = new QueryClient();
    let ready = false;
    let changed: CacheChangeListener | undefined;
    checkpoint.mockImplementation(() => ({
      completedAt: transition === 'context' || ready ? 1 : null,
    }));
    const host: CacheHost = {
      ...createNoopCacheHost(),
      disabled: false,
      onCacheChanged: (listener) => {
        changed = listener;
        return () => {};
      },
      people: {
        readSql: async () => ({ kind: 'unsupported' }),
        ...unsupportedContactSync,
        context: async () =>
          ready ? { kind: 'ready', epoch: GENERATION } : { kind: 'missing' },
        resolveReferences: async () => ({ kind: 'unsupported' }),
        search: async () => ({ kind: 'unsupported' }),
        update: async () => parseCacheRevision('1'),
      },
    };
    const reader = vi
      .fn<ContactReferenceReader>()
      .mockImplementation(async () => ({
        source: 'cache',
        offline: true,
        matches: [{ complete: ready, people: [person] }],
        native: {
          generation: GENERATION,
          completedAt: transition === 'context' || ready ? 1 : null,
          contextPending: transition === 'context' && !ready,
          supported: true,
        },
      }));
    let source: ReturnType<typeof createContactReferenceSource> | undefined;
    function Harness() {
      source = createContactReferenceSource(
        () => ({ userId: 'viewer', host }),
        () => ({
          labels: ['Sam'],
          matching: 'preferFullName',
          excludeSecondaryInboxes: transition === 'context',
        }),
        () => true,
        reader
      );
      return null;
    }
    const view = render(() => (
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    ));
    await vi.advanceTimersByTimeAsync(0);
    expect(source!.lookup('Sam')).toBeUndefined();
    for (let i = 0; i < 5; i++) {
      changed!(parseCacheRevision(String(i + 1)), {
        searchChangedBuckets: ['person'],
      });
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(reader).toHaveBeenCalledOnce();
    ready = true;
    changed!(parseCacheRevision('6'), { searchChangedBuckets: ['person'] });
    await vi.advanceTimersByTimeAsync(300);
    expect(source!.lookup('Sam')).toEqual([person]);
    expect(source!.ready()).toBe(true);
    expect(reader).toHaveBeenCalledTimes(2);
    changed!(parseCacheRevision('7'), { searchChangedBuckets: ['person'] });
    await vi.advanceTimersByTimeAsync(300);
    expect(reader).toHaveBeenCalledTimes(2);
    view.unmount();
    client.clear();
  }
);

it('does not refetch after a readiness probe completes past disposal', async () => {
  const client = new QueryClient();
  checkpoint.mockReturnValue({ completedAt: 1 });
  const entered = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  const host: CacheHost = {
    ...createNoopCacheHost(),
    disabled: false,
    people: {
      readSql: async () => ({ kind: 'unsupported' }),
      ...unsupportedContactSync,
      context: async () => {
        entered.resolve();
        await ready.promise;
        return { kind: 'ready', epoch: GENERATION };
      },
      resolveReferences: async () => ({ kind: 'unsupported' }),
      search: async () => ({ kind: 'unsupported' }),
      update: async () => parseCacheRevision('1'),
    },
  };
  const reader = vi.fn<ContactReferenceReader>().mockResolvedValue({
    source: 'unavailable',
    offline: true,
    matches: [{ complete: false, people: [] }],
    native: {
      generation: GENERATION,
      completedAt: 1,
      contextPending: true,
      supported: true,
    },
  });
  function Harness() {
    createContactReferenceSource(
      () => ({ userId: 'viewer', host }),
      () => ({
        labels: ['Sam'],
        matching: 'exact',
        excludeSecondaryInboxes: true,
      }),
      () => true,
      reader
    );
    return null;
  }
  const view = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await entered.promise;
  view.unmount();
  ready.resolve();
  await ready.promise;
  expect(reader).toHaveBeenCalledOnce();
  client.clear();
});

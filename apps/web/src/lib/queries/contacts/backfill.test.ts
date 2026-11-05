import { createPeopleCache } from '@graphql-cache/people/host';
import { unsupportedPeopleTransport } from '@graphql-cache/people/test-support';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import { hydrateGraphqlContacts } from '@service-storage/graphql-contacts';
import { render } from '@solidjs/testing-library';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import { createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  loadContactCheckpoint,
  runContactBackfill,
  subscribeContactCheckpoint,
  useContactBackfill,
} from './backfill';
import type { reconcileContactPage } from './reconcile';

vi.mock('@service-storage/graphql-contacts', () => ({
  hydrateGraphqlContacts: vi.fn(),
  fetchContactDirectoryByIds: vi.fn(),
}));

const GENERATION = '00000000-0000-4000-8000-000000000001';
const REPLACEMENT = '00000000-0000-4000-8000-000000000002';
const viewer = 'macro|viewer@example.com';
const [account, setAccount] = createSignal({ userId: viewer, session: 0 });
vi.mock('../auth/use-query-account', () => ({
  useQueryAccount: () => account,
}));
function host() {
  return {
    people: createPeopleCache({
      ...unsupportedPeopleTransport,
      snapshot: async () => ({
        fence: GENERATION,
        ids: [],
        nextCursor: null,
        incomplete: false,
      }),
      reconcile: async () => INITIAL_CACHE_REVISION,
    }),
    currentStorageGeneration: vi.fn(async () => GENERATION),
    search: vi.fn(async () => ({
      projectionVersion: 5,
      documents: [],
      nextCursor: null,
    })),
    hydrateQuery: vi.fn(async () => ({
      kind: 'void' as const,
      revision: INITIAL_CACHE_REVISION,
    })),
  };
}
const page = (cursor: string | null) => ({
  user: { id: viewer, contacts: { nextCursor: cursor } },
});

beforeEach(() => {
  localStorage.clear();
  setAccount({ userId: viewer, session: 0 });
});

it('persists only successful progress, resumes failures, and accepts empty pages with a cursor', async () => {
  const cache = host();
  const fetchPage = vi
    .fn<typeof hydrateGraphqlContacts>()
    .mockResolvedValueOnce(page('after-empty'))
    .mockRejectedValueOnce(new Error('offline'));
  await expect(
    Effect.runPromise(
      runContactBackfill(viewer, cache, { fetchPage, pageDelayMs: 0 })
    )
  ).rejects.toThrow();
  expect(loadContactCheckpoint(viewer, GENERATION)).toMatchObject({
    nextCursor: 'after-empty',
    pages: 1,
    completedAt: null,
  });
  fetchPage.mockResolvedValueOnce(page(null));
  await Effect.runPromise(
    runContactBackfill(viewer, cache, { fetchPage, pageDelayMs: 0 })
  );
  expect(fetchPage.mock.calls.map((call) => call[2])).toEqual([
    null,
    'after-empty',
    'after-empty',
  ]);
  expect(fetchPage.mock.calls[2][1]).toEqual({
    identity: viewer,
    storageGeneration: GENERATION,
  });
  expect(loadContactCheckpoint(viewer, GENERATION)).toMatchObject({
    nextCursor: null,
    pages: 2,
    completedAt: expect.any(Number),
  });
});

it('publishes completion only after acknowledgement and persisted checkpoint, with scoped cleanup', async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<ReturnType<typeof page>>();
  const notified = vi.fn(() => {
    expect(
      loadContactCheckpoint(viewer, GENERATION).completedAt
    ).not.toBeNull();
  });
  const foreign = vi.fn();
  const stop = subscribeContactCheckpoint(viewer, notified);
  const stopForeign = subscribeContactCheckpoint(
    'macro|other@example.com',
    foreign
  );
  const stopThrowing = subscribeContactCheckpoint(viewer, () => {
    throw new Error('observer failed');
  });
  try {
    const running = Effect.runPromise(
      runContactBackfill(viewer, host(), {
        pageDelayMs: 0,
        fetchPage: async () => {
          entered.resolve();
          return release.promise;
        },
      })
    );
    await entered.promise;
    expect(notified).not.toHaveBeenCalled();
    release.resolve(page(null));
    await running;
    expect(notified).toHaveBeenCalledOnce();
    expect(foreign).not.toHaveBeenCalled();
    stop();
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: `graphql-contacts-backfill:v2:${viewer}`,
        newValue: JSON.stringify(loadContactCheckpoint(viewer, GENERATION)),
      })
    );
    expect(notified).toHaveBeenCalledOnce();
  } finally {
    stop();
    stopForeign();
    stopThrowing();
  }
});

it('rejects a generation change during hydration and restarts in the replacement generation', async () => {
  const cache = host();
  const fetchPage = vi
    .fn<typeof hydrateGraphqlContacts>()
    .mockImplementationOnce(async () => {
      cache.currentStorageGeneration.mockResolvedValue(REPLACEMENT);
      return page('stale');
    });
  await expect(
    Effect.runPromise(runContactBackfill(viewer, cache, { fetchPage }))
  ).rejects.toThrow('scope changed');
  expect(loadContactCheckpoint(viewer, REPLACEMENT)).toMatchObject({
    nextCursor: null,
    pages: 0,
  });
  fetchPage.mockResolvedValue(page(null));
  await Effect.runPromise(runContactBackfill(viewer, cache, { fetchPage }));
  expect(fetchPage.mock.calls[1][2]).toBeNull();
  expect(fetchPage.mock.calls[1][1].storageGeneration).toBe(REPLACEMENT);
  expect(loadContactCheckpoint('other', REPLACEMENT).pages).toBe(0);
});

it('does not fetch on unsupported engines or rescan completed snapshots inside the refresh interval', async () => {
  const cache = host();
  const fetchPage = vi
    .fn<typeof hydrateGraphqlContacts>()
    .mockResolvedValue(page(null));
  cache.search.mockResolvedValue({
    projectionVersion: 4,
    documents: [],
    nextCursor: null,
  });
  expect(
    await Effect.runPromise(runContactBackfill(viewer, cache, { fetchPage }))
  ).toEqual({ kind: 'unsupported' });
  expect(fetchPage).not.toHaveBeenCalled();
  cache.search.mockResolvedValue({
    projectionVersion: 5,
    documents: [],
    nextCursor: null,
  });
  await Effect.runPromise(runContactBackfill(viewer, cache, { fetchPage }));
  await Effect.runPromise(
    runContactBackfill(viewer, cache, { fetchPage, refresh: true })
  );
  expect(fetchPage).toHaveBeenCalledTimes(1);
});

it('coalesces invalidations and refreshes names hourly without graph events', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  try {
    const cache = host();
    const fetchPage = vi
      .fn<typeof hydrateGraphqlContacts>()
      .mockResolvedValue(page(null));
    await Effect.runPromise(runContactBackfill(viewer, cache, { fetchPage }));
    clock.mockReturnValue(1_000_000 + 16 * 60_000);
    await Effect.runPromise(
      runContactBackfill(viewer, cache, { fetchPage, refresh: true })
    );
    await Effect.runPromise(
      runContactBackfill(viewer, cache, { fetchPage, refresh: true })
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(1_000_000 + 77 * 60_000);
    await Effect.runPromise(runContactBackfill(viewer, cache, { fetchPage }));
    expect(fetchPage).toHaveBeenCalledTimes(3);
  } finally {
    clock.mockRestore();
  }
});

it.each(['account', 'session', 'generation', 'dispose'])(
  'aborts the mounted runner on %s changes',
  async (change) => {
    const cache = host();
    const [user, setUser] = createSignal<string | undefined>(viewer);
    const [generation, setGeneration] = createSignal(0);
    const started = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const pending =
      Promise.withResolvers<
        Awaited<ReturnType<typeof hydrateGraphqlContacts>>
      >();
    vi.mocked(hydrateGraphqlContacts).mockImplementation(
      (_host, _scope, _after, signal) => {
        signal.addEventListener('abort', () => aborted.resolve(), {
          once: true,
        });
        started.resolve();
        return pending.promise;
      }
    );
    const mounted = render(() => {
      useContactBackfill(user, () => cache, generation);
      return null;
    });
    await started.promise;
    if (change === 'account') setUser(undefined);
    else if (change === 'session') setAccount({ userId: viewer, session: 1 });
    else if (change === 'generation') setGeneration(1);
    else mounted.unmount();
    await aborted.promise;
    mounted.unmount();
    pending.resolve(page('late'));
    await pending.promise;
    expect(loadContactCheckpoint(viewer, GENERATION).pages).toBe(0);
  }
);

it('interrupts an uncancellable fetch without saving its late cursor', async () => {
  const started = Promise.withResolvers<void>();
  const pending =
    Promise.withResolvers<Awaited<ReturnType<typeof hydrateGraphqlContacts>>>();
  const fetchPage = vi
    .fn<typeof hydrateGraphqlContacts>()
    .mockImplementation(() => {
      started.resolve();
      return pending.promise;
    });
  const fiber = Effect.runFork(
    runContactBackfill(viewer, host(), { fetchPage })
  );
  await started.promise;
  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(fetchPage.mock.calls[0][3].aborted).toBe(true);
  pending.resolve(page('late'));
  await pending.promise;
  expect(loadContactCheckpoint(viewer, GENERATION)).toMatchObject({
    nextCursor: null,
    pages: 0,
    completedAt: null,
  });
});

it('does not complete at hydration end, and resumes failed verification without rehydrating', async () => {
  const cache = host();
  const fetchPage = vi
    .fn<typeof hydrateGraphqlContacts>()
    .mockResolvedValue(page(null));
  const reconcilePage = vi
    .fn<typeof reconcileContactPage>()
    .mockResolvedValueOnce({ nextCursor: 'row-500', incomplete: false })
    .mockRejectedValueOnce(new Error('offline'));
  await expect(
    Effect.runPromise(
      runContactBackfill(viewer, cache, {
        fetchPage,
        reconcilePage,
        pageDelayMs: 0,
      })
    )
  ).rejects.toThrow();
  expect(loadContactCheckpoint(viewer, GENERATION)).toMatchObject({
    phase: 'verify',
    nextCursor: 'row-500',
    completedAt: null,
  });
  reconcilePage.mockResolvedValueOnce({ nextCursor: null, incomplete: false });
  await Effect.runPromise(
    runContactBackfill(viewer, cache, {
      fetchPage,
      reconcilePage,
      pageDelayMs: 0,
    })
  );
  expect(fetchPage).toHaveBeenCalledOnce();
  expect(reconcilePage.mock.calls.map((call) => call[2])).toEqual([
    null,
    'row-500',
    'row-500',
  ]);
  expect(loadContactCheckpoint(viewer, GENERATION).completedAt).not.toBeNull();
});

it('does not publish completeness when any local verification window is malformed', async () => {
  const fetchPage = vi
    .fn<typeof hydrateGraphqlContacts>()
    .mockResolvedValue(page(null));
  const reconcilePage = vi
    .fn<typeof reconcileContactPage>()
    .mockResolvedValueOnce({ nextCursor: 'next', incomplete: true })
    .mockResolvedValueOnce({ nextCursor: null, incomplete: false });
  const result = await Effect.runPromise(
    runContactBackfill(viewer, host(), {
      fetchPage,
      reconcilePage,
      pageDelayMs: 0,
    })
  );
  expect(result.kind).toBe('partial');
  expect(loadContactCheckpoint(viewer, GENERATION).completedAt).toBeNull();
});

it('cancels a late verification acknowledgement without advancing its checkpoint', async () => {
  const entered = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<{
    nextCursor: string | null;
    incomplete: boolean;
  }>();
  const fetchPage = vi
    .fn<typeof hydrateGraphqlContacts>()
    .mockResolvedValue(page(null));
  const reconcilePage = vi
    .fn<typeof reconcileContactPage>()
    .mockImplementation(() => {
      entered.resolve();
      return pending.promise;
    });
  const fiber = Effect.runFork(
    runContactBackfill(viewer, host(), {
      fetchPage,
      reconcilePage,
      pageDelayMs: 0,
    })
  );
  await entered.promise;
  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(reconcilePage.mock.calls[0][3].aborted).toBe(true);
  pending.resolve({ nextCursor: 'late', incomplete: false });
  await pending.promise;
  expect(loadContactCheckpoint(viewer, GENERATION)).toMatchObject({
    phase: 'verify',
    nextCursor: null,
    completedAt: null,
  });
});

it('a 100k-directory scan consumes bounded hydration and verification windows without accumulating payloads', async () => {
  let pages = 0;
  let verified = 0;
  const reconcilePage = vi.fn<typeof reconcileContactPage>(
    async (_host, _scope, after) => {
      expect(after).toBe(verified ? `verify-${verified}` : null);
      expect(loadContactCheckpoint(viewer, GENERATION).completedAt).toBeNull();
      verified++;
      return {
        nextCursor: verified === 200 ? null : `verify-${verified}`,
        incomplete: false,
      };
    }
  );
  const fetchPage = vi
    .fn<typeof hydrateGraphqlContacts>()
    .mockImplementation(async (_host, _scope, after) => {
      expect(after).toBe(pages ? `page-${pages}` : null);
      pages += 1;
      return page(pages === 200 ? null : `page-${pages}`);
    });
  await Effect.runPromise(
    runContactBackfill(viewer, host(), {
      fetchPage,
      reconcilePage,
      pageDelayMs: 0,
    })
  );
  expect(pages).toBe(200);
  expect(verified).toBe(200);
  expect(loadContactCheckpoint(viewer, GENERATION).pages).toBe(200);
  expect(
    localStorage.getItem(`graphql-contacts-backfill:v2:${viewer}`)!.length
  ).toBeLessThan(300);
});

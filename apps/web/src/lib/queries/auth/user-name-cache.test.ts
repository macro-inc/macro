import { onlineManager, QueryClient } from '@tanstack/solid-query';
import { createRenderEffect, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { QueryAccount } from './account-scope';
import {
  createUserNameCache,
  USER_NAME_CACHE_LIMITS as LIMITS,
  UserNameAccessError,
  type UserNameBatchReader,
  type UserNameCache,
  type UserNameState,
} from './user-name-cache';

const VIEWER = { userId: 'macro|viewer@example.com', session: 0 };
const PERSON = 'macro|person@example.com';
let cache: UserNameCache;
let client: QueryClient;
let fetch: ReturnType<typeof vi.fn<UserNameBatchReader>>;
let setAccount: (value: QueryAccount | undefined) => void;
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient();
  const [account, updateAccount] = createSignal<QueryAccount | undefined>(
    VIEWER
  );
  setAccount = updateAccount;
  fetch = vi
    .fn<UserNameBatchReader>()
    .mockImplementation(async (_owner, ids) =>
      ids.map((id) => ({ id, first_name: 'Resolved', last_name: 'Name' }))
    );
  cache = createUserNameCache({ client, account, fetch });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  cache.dispose();
  client.clear();
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

it('serializes large active sets without a promise/ID backlog and retains their labels through pressure', async () => {
  let latest: UserNameState | undefined;
  createRoot((dispose) => {
    cleanups.push(dispose);
    createRenderEffect(() => {
      for (let index = 0; index < 1100; index++)
        latest = cache.read(`macro|active${index}@example.com`);
    });
  });
  expect(cache.inspect()).toMatchObject({ active: 1100, pending: 500 });
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch.mock.calls.map(([, ids]) => ids.length)).toEqual([
    500, 500, 100,
  ]);
  expect(latest?.name?.first_name).toBe('Resolved');
  expect(cache.inspect().active).toBe(1100);
  // No corpus-sized fixture: each unowned read is released before the next.
  for (let index = 0; index < 100_000; index++)
    cache.read(`macro|browse${index}@example.com`);
  expect(cache.inspect().idle).toBeLessThanOrEqual(LIMITS.idleEntries);
  expect(cache.inspect().idleBytes).toBeLessThanOrEqual(LIMITS.idleBytes);
  expect(cache.inspect().pending).toBeLessThanOrEqual(LIMITS.pending);
  expect(client.getQueryCache().getAll().length).toBeLessThanOrEqual(
    1100 + LIMITS.idleEntries
  );
  expect(cache.read('macro|active1099@example.com').name?.first_name).toBe(
    'Resolved'
  );
  cleanups.splice(0).forEach((dispose) => dispose());
  await Promise.resolve();
  expect(cache.inspect().entries).toBeLessThanOrEqual(LIMITS.idleEntries);
}, 20000);

it('keeps idle lookups bounded even before a disposed reader cleanup microtask runs', () => {
  const dispose = createRoot((dispose) => {
    createRenderEffect(() => cache.read(PERSON));
    return dispose;
  });
  dispose();
  for (let index = 0; index < 10_000; index++)
    cache.read(`macro|untracked${index}@example.com`);
  expect(cache.inspect().entries).toBeLessThanOrEqual(LIMITS.idleEntries + 1);
  expect(cache.inspect().pending).toBeLessThanOrEqual(LIMITS.pending);
});

it('ignores invalid identities individually instead of poisoning another name request', async () => {
  for (const id of [
    '',
    'macro|broken@@example.com',
    'macro|bad$local@example.com',
    'macro|bad\\0@example.com',
    ' '.repeat(2000),
  ])
    cache.read(id);
  cache.read('  MACRO|PERSON@EXAMPLE.COM  ');
  await vi.advanceTimersByTimeAsync(10);
  expect(fetch.mock.calls[0][1]).toEqual([PERSON]);
  expect(cache.inspect().entries).toBe(1);
});

it('applies retention bounds to explicit refetch and clears late work on disposal', async () => {
  for (let index = 0; index < 2000; index++)
    cache.control(`macro|explicit${index}@example.com`).refetch();
  expect(cache.inspect().entries).toBeLessThanOrEqual(LIMITS.idleEntries);
  expect(cache.inspect().pending).toBeLessThanOrEqual(LIMITS.pending);
  const held =
    Promise.withResolvers<Awaited<ReturnType<UserNameBatchReader>>>();
  fetch.mockReturnValueOnce(held.promise);
  await vi.advanceTimersByTimeAsync(10);
  const ids = fetch.mock.calls[0][1];
  cache.dispose();
  held.resolve(ids.map((id) => ({ id, first_name: 'Late' })));
  await vi.advanceTimersByTimeAsync(100);
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(cache.inspect()).toMatchObject({
    entries: 0,
    pending: 0,
    inFlight: 0,
  });
});

it('deduplicates active labels and drops queued interests when owners disappear', async () => {
  const held =
    Promise.withResolvers<Awaited<ReturnType<UserNameBatchReader>>>();
  fetch.mockReturnValueOnce(held.promise);
  createRoot((dispose) => {
    cleanups.push(dispose);
    createRenderEffect(() => {
      for (let index = 0; index < 1500; index++)
        cache.read(`macro|active${index}@example.com`);
    });
    createRenderEffect(() => cache.read('MACRO|ACTIVE0@example.com'));
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(fetch).toHaveBeenCalledOnce();
  expect(cache.inspect().inFlight).toBe(500);
  cleanups.splice(0).forEach((dispose) => dispose());
  await Promise.resolve();
  held.resolve([]);
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledOnce();
  expect(cache.inspect().pending).toBe(0);
  expect(cache.inspect().entries).toBeLessThanOrEqual(LIMITS.idleEntries);
});

it('keeps active labels during stale refresh and does not loop when a response reevaluates readers', async () => {
  const [revision, update] = createSignal(0);
  const labels: (string | null | undefined)[] = [];
  createRoot((dispose) => {
    cleanups.push(dispose);
    createRenderEffect(() => {
      revision();
      labels.push(cache.read(PERSON).name?.first_name);
    });
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(labels.at(-1)).toBe('Resolved');
  const held =
    Promise.withResolvers<Awaited<ReturnType<UserNameBatchReader>>>();
  fetch.mockReturnValueOnce(held.promise);
  await vi.advanceTimersByTimeAsync(LIMITS.freshMs + 1);
  expect(fetch).toHaveBeenCalledOnce();
  update(1);
  await vi.advanceTimersByTimeAsync(10);
  expect(labels.at(-1)).toBe('Resolved');
  held.resolve([{ id: PERSON, first_name: 'Fresh' }]);
  await vi.advanceTimersByTimeAsync(100);
  expect(labels.at(-1)).toBe('Fresh');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('clears immediately across account returns and rejects old replies and captured mutations', async () => {
  const held =
    Promise.withResolvers<Awaited<ReturnType<UserNameBatchReader>>>();
  const labels: (string | null | undefined)[] = [];
  createRoot((dispose) => {
    cleanups.push(dispose);
    createRenderEffect(() => labels.push(cache.read(PERSON).name?.first_name));
  });
  await vi.advanceTimersByTimeAsync(10);
  const old = cache.control(PERSON);
  fetch.mockReturnValueOnce(held.promise);
  old.refetch();
  await vi.advanceTimersByTimeAsync(10);
  setAccount({ userId: 'macro|other@example.com', session: 0 });
  setAccount(VIEWER);
  expect(labels.at(-1)).toBeUndefined();
  old.mutate({ id: PERSON, first_name: 'Stale override' });
  old.refetch();
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(2);
  held.resolve([{ id: PERSON, first_name: 'Private old name' }]);
  await vi.advanceTimersByTimeAsync(100);
  expect(labels).not.toContain('Private old name');
  expect(labels).not.toContain('Stale override');
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(labels.at(-1)).toBe('Resolved');
  expect(client.getQueryCache().getAll()).toHaveLength(1);
});

it('waits for authentication and isolates replacement sessions of the same viewer', async () => {
  setAccount(undefined);
  let value: UserNameState | undefined;
  createRoot((dispose) => {
    cleanups.push(dispose);
    createRenderEffect(() => {
      value = cache.read(PERSON);
    });
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).not.toHaveBeenCalled();
  setAccount(VIEWER);
  await vi.advanceTimersByTimeAsync(10);
  expect(value?.name?.first_name).toBe('Resolved');
  setAccount({ ...VIEWER, session: 1 });
  expect(value?.name).toBeUndefined();
  await vi.advanceTimersByTimeAsync(10);
  expect(fetch.mock.calls.map(([owner]) => owner.session)).toEqual([0, 1]);
});

it('aborts timed-out batches without polling or retaining request timers', async () => {
  fetch.mockImplementationOnce(
    (_owner, _ids, _wait, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      })
  );
  let value: UserNameState | undefined;
  createRoot((dispose) => {
    cleanups.push(dispose);
    createRenderEffect(() => {
      value = cache.read(PERSON);
    });
  });
  await vi.advanceTimersByTimeAsync(
    LIMITS.batchWaitMs + LIMITS.requestTimeoutMs
  );
  expect(value?.loading).toBe(false);
  expect(value?.error).toBe('Names unavailable');
  expect(cache.inspect().inFlight).toBe(0);
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(fetch).toHaveBeenCalledOnce();
});

it('bounds failure retries to later access, completes omitted names and keeps successes during transient errors', async () => {
  fetch.mockRejectedValueOnce(new Error('offline'));
  let value: UserNameState | undefined;
  const [revision, update] = createSignal(0);
  createRoot((dispose) => {
    cleanups.push(dispose);
    createRenderEffect(() => {
      revision();
      value = cache.read(PERSON);
    });
  });
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(fetch).toHaveBeenCalledOnce();
  expect(value?.loading).toBe(false);
  update(1);
  await vi.advanceTimersByTimeAsync(10);
  expect(value?.name?.first_name).toBe('Resolved');
  fetch.mockRejectedValueOnce(new Error('offline'));
  cache.control(PERSON).refetch();
  await vi.advanceTimersByTimeAsync(10);
  expect(value?.name?.first_name).toBe('Resolved');
  expect(value?.error).toBe('Names unavailable');
  fetch.mockResolvedValueOnce([]);
  cache.control(PERSON).refetch();
  await vi.advanceTimersByTimeAsync(10);
  expect(value?.name).toBeNull();
  expect(value?.loading).toBe(false);
});

it('reconnect wakes only active failed names without waiting for a new render', async () => {
  onlineManager.setOnline(false);
  fetch.mockRejectedValueOnce(new Error('offline'));
  let value: UserNameState | undefined;
  createRoot((dispose) => {
    cleanups.push(dispose);
    createRenderEffect(() => {
      value = cache.read(PERSON);
    });
  });
  cache.read('macro|idle@example.com');
  await vi.advanceTimersByTimeAsync(10);
  expect(value?.error).toBe('Names unavailable');
  onlineManager.setOnline(true);
  await vi.advanceTimersByTimeAsync(10);
  expect(fetch.mock.calls[1][1]).toEqual([PERSON]);
  expect(value?.name?.first_name).toBe('Resolved');
});

it('authorization refusal clears prior private labels and blocks new requests until a new scope', async () => {
  const labels: (string | null | undefined)[] = [];
  createRoot((dispose) => {
    cleanups.push(dispose);
    createRenderEffect(() => labels.push(cache.read(PERSON).name?.first_name));
  });
  await vi.advanceTimersByTimeAsync(10);
  fetch.mockRejectedValueOnce(new UserNameAccessError());
  cache.control(PERSON).refetch();
  await vi.advanceTimersByTimeAsync(10);
  expect(labels.at(-1)).toBeUndefined();
  cache.read('macro|another@example.com');
  cache.control(PERSON).refetch();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  setAccount({ ...VIEWER, session: 1 });
  await vi.advanceTimersByTimeAsync(10);
  expect(labels.at(-1)).toBe('Resolved');
});

it('manual overrides win over older in-flight responses and expired controls cannot resurrect work', async () => {
  const held =
    Promise.withResolvers<Awaited<ReturnType<UserNameBatchReader>>>();
  fetch.mockReturnValueOnce(held.promise);
  cache.read(PERSON);
  await vi.advanceTimersByTimeAsync(10);
  const controls = cache.control(PERSON);
  controls.mutate({ id: PERSON, first_name: 'Manual' });
  held.resolve([{ id: PERSON, first_name: 'Old network' }]);
  await vi.advanceTimersByTimeAsync(10);
  expect(cache.read(PERSON).name?.first_name).toBe('Manual');
  const disposed = createRoot((dispose) => ({
    control: cache.control(PERSON),
    dispose,
  }));
  disposed.dispose();
  disposed.control.refetch();
  disposed.control.mutate({ id: PERSON, first_name: 'Disposed' });
  await vi.advanceTimersByTimeAsync(10);
  expect(cache.read(PERSON).name?.first_name).toBe('Manual');
  expect(fetch).toHaveBeenCalledOnce();
});

it('enforces text budgets without accepting unsolicited, duplicate or oversized names', async () => {
  fetch.mockImplementationOnce(async (_owner, ids) => [
    ...ids.map((id) => ({ id, first_name: 'x'.repeat(4096) })),
  ]);
  for (let index = 0; index < 100; index++)
    cache.read(`macro|bytes${index}@example.com`);
  await vi.advanceTimersByTimeAsync(10);
  expect(cache.inspect().idleBytes).toBeLessThanOrEqual(LIMITS.idleBytes);
  expect(cache.inspect().idle).toBeLessThan(100);
  fetch.mockResolvedValueOnce([
    { id: PERSON, first_name: 'x'.repeat(LIMITS.entryBytes) },
    { id: 'macro|duplicate@example.com', first_name: 'One' },
    { id: 'macro|duplicate@example.com', first_name: 'Two' },
    { id: 'macro|unsolicited@example.com', first_name: 'Foreign' },
    { id: 'macro|good@example.com', first_name: 'Good' },
  ]);
  cache.read(PERSON);
  cache.read('macro|duplicate@example.com');
  cache.read('macro|good@example.com');
  await vi.advanceTimersByTimeAsync(10);
  expect(cache.read(PERSON).name).toBeUndefined();
  expect(cache.read('macro|duplicate@example.com').name).toBeUndefined();
  expect(cache.read('macro|good@example.com').name?.first_name).toBe('Good');
  expect(
    client
      .getQueryCache()
      .getAll()
      .some(
        (query) => query.queryKey.at(-1) === 'macro|unsolicited@example.com'
      )
  ).toBe(false);
});

it('evicts idle history by time and drops obsolete responses instead of repopulating an evicted slot', async () => {
  const held =
    Promise.withResolvers<Awaited<ReturnType<UserNameBatchReader>>>();
  fetch.mockReturnValueOnce(held.promise);
  cache.read(PERSON);
  await vi.advanceTimersByTimeAsync(10);
  for (let index = 0; index < 1000; index++)
    cache.read(`macro|other${index}@example.com`);
  cache.read(PERSON);
  held.resolve([{ id: PERSON, first_name: 'Obsolete slot' }]);
  await vi.advanceTimersByTimeAsync(100);
  expect(cache.read(PERSON).name?.first_name).toBe('Resolved');
  await vi.advanceTimersByTimeAsync(LIMITS.idleMs + 1);
  expect(cache.inspect().entries).toBe(0);
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});

it('arms one idle expiry timer for many reads and still expires each name on time', async () => {
  const timers = vi.spyOn(globalThis, 'setTimeout');
  for (let index = 0; index < 50; index++)
    cache.read(`macro|idle${index}@example.com`);
  const expiryTimers = timers.mock.calls.filter(
    ([, delay]) => delay === LIMITS.idleMs
  );
  timers.mockRestore();
  expect(expiryTimers).toHaveLength(1);
  expect(cache.inspect().idle).toBe(50);

  await vi.advanceTimersByTimeAsync(LIMITS.idleMs / 2);
  cache.read('macro|idle0@example.com');
  cache.read('macro|late@example.com');
  expect(cache.inspect().idle).toBe(51);

  await vi.advanceTimersByTimeAsync(LIMITS.idleMs / 2);
  expect(cache.inspect().idle).toBe(2);

  await vi.advanceTimersByTimeAsync(LIMITS.idleMs / 2);
  expect(cache.inspect().idle).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

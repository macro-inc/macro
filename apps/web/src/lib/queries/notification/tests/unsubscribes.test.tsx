import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationKeys } from '../keys';
import { useMuteItemMutation, useUnmuteItemMutation } from '../unsubscribes';

const {
  getUnsubscribesMock,
  unsubscribeItemMock,
  removeUnsubscribeItemMock,
} = vi.hoisted(() => ({
  getUnsubscribesMock: vi.fn(),
  unsubscribeItemMock: vi.fn(),
  removeUnsubscribeItemMock: vi.fn(),
}));

vi.mock('@service-notification/client', () => ({
  notificationServiceClient: {
    getUnsubscribes: getUnsubscribesMock,
    unsubscribeItem: unsubscribeItemMock,
    removeUnsubscribeItem: removeUnsubscribeItemMock,
  },
}));

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

const item = (id = 'doc-1'): UserUnsubscribe => ({
  item_id: id,
  item_type: 'document',
});

const cached = () =>
  testQueryClient.getQueryData<UserUnsubscribe[]>(
    notificationKeys.unsubscribes.queryKey
  );

const cachedIds = () => cached()?.map((entry) => entry.item_id).sort();

const hasUnsubscribesQuery = () =>
  testQueryClient.getQueryState(notificationKeys.unsubscribes.queryKey) !=
  null;

const httpError = () =>
  err([{ code: 'HTTP_ERROR' as const, message: 'nope' }]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let dispose: (() => void) | undefined;

function renderHook<T>(factory: () => T): T {
  let hook!: T;
  dispose = render(
    () => (
      <QueryClientProvider client={testQueryClient}>
        {(() => {
          hook = factory();
          return null as unknown as JSX.Element;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Hang so onSettled invalidate cannot refill the cache after rollback.
  getUnsubscribesMock.mockReturnValue(new Promise(() => {}));
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  testQueryClient.clear();
});

describe('useMuteItemMutation', () => {
  it('restores a cached list when mute fails', async () => {
    const existing = [item('other')];
    testQueryClient.setQueryData(
      notificationKeys.unsubscribes.queryKey,
      existing
    );
    unsubscribeItemMock.mockResolvedValue(httpError());
    const mute = renderHook(() => useMuteItemMutation());

    await expect(mute.mutateAsync(item())).rejects.toThrow();

    expect(cached()).toEqual(existing);
  });

  it('removes the optimistic query when mute fails with no prior cache', async () => {
    const pending = deferred<ReturnType<typeof httpError>>();
    unsubscribeItemMock.mockReturnValue(pending.promise);
    const mute = renderHook(() => useMuteItemMutation());
    const result = mute.mutateAsync(item());

    await vi.waitFor(() => {
      expect(cached()).toEqual([item()]);
      expect(hasUnsubscribesQuery()).toBe(true);
    });

    pending.resolve(httpError());
    await expect(result).rejects.toThrow();

    expect(cached()).toBeUndefined();
    expect(hasUnsubscribesQuery()).toBe(false);
  });

  it('keeps a sibling optimistic mute when one mute fails', async () => {
    testQueryClient.setQueryData(notificationKeys.unsubscribes.queryKey, [
      item('existing'),
    ]);
    const fail = deferred<ReturnType<typeof httpError>>();
    const succeed = deferred<ReturnType<typeof ok>>();
    unsubscribeItemMock.mockImplementation((arg: UserUnsubscribe) =>
      arg.item_id === 'doc-1' ? fail.promise : succeed.promise
    );
    const mute = renderHook(() => useMuteItemMutation());
    const failed = mute.mutateAsync(item('doc-1'));
    const succeeded = mute.mutateAsync(item('doc-2'));

    await vi.waitFor(() => {
      expect(cachedIds()).toEqual(['doc-1', 'doc-2', 'existing']);
    });

    fail.resolve(httpError());
    await expect(failed).rejects.toThrow();
    expect(cachedIds()).toEqual(['doc-2', 'existing']);

    succeed.resolve(ok({}));
    await succeeded;
    expect(cachedIds()).toEqual(['doc-2', 'existing']);
  });

  it('does not drop a sibling mute when a no-cache mute fails', async () => {
    const fail = deferred<ReturnType<typeof httpError>>();
    const hang = deferred<ReturnType<typeof ok>>();
    unsubscribeItemMock.mockImplementation((arg: UserUnsubscribe) =>
      arg.item_id === 'doc-1' ? fail.promise : hang.promise
    );
    const mute = renderHook(() => useMuteItemMutation());
    const failed = mute.mutateAsync(item('doc-1'));
    void mute.mutateAsync(item('doc-2'));

    await vi.waitFor(() => {
      expect(cachedIds()).toEqual(['doc-1', 'doc-2']);
    });

    fail.resolve(httpError());
    await expect(failed).rejects.toThrow();

    expect(cachedIds()).toEqual(['doc-2']);
    expect(hasUnsubscribesQuery()).toBe(true);
  });
});

describe('useUnmuteItemMutation', () => {
  it('restores a cached list when unmute fails', async () => {
    const existing = [item()];
    testQueryClient.setQueryData(
      notificationKeys.unsubscribes.queryKey,
      existing
    );
    removeUnsubscribeItemMock.mockResolvedValue(httpError());
    const unmute = renderHook(() => useUnmuteItemMutation());

    await expect(unmute.mutateAsync(item())).rejects.toThrow();

    expect(cached()).toEqual(existing);
  });

  it('removes the optimistic query when unmute fails with no prior cache', async () => {
    const pending = deferred<ReturnType<typeof httpError>>();
    removeUnsubscribeItemMock.mockReturnValue(pending.promise);
    const unmute = renderHook(() => useUnmuteItemMutation());
    const result = unmute.mutateAsync(item());

    await vi.waitFor(() => {
      expect(cached()).toEqual([]);
      expect(hasUnsubscribesQuery()).toBe(true);
    });

    pending.resolve(httpError());
    await expect(result).rejects.toThrow();

    expect(cached()).toBeUndefined();
    expect(hasUnsubscribesQuery()).toBe(false);
  });

  it('keeps a sibling unmute when one unmute fails', async () => {
    testQueryClient.setQueryData(notificationKeys.unsubscribes.queryKey, [
      item('doc-1'),
      item('doc-2'),
    ]);
    const fail = deferred<ReturnType<typeof httpError>>();
    const succeed = deferred<ReturnType<typeof ok>>();
    removeUnsubscribeItemMock.mockImplementation((arg: UserUnsubscribe) =>
      arg.item_id === 'doc-1' ? fail.promise : succeed.promise
    );
    const unmute = renderHook(() => useUnmuteItemMutation());
    const failed = unmute.mutateAsync(item('doc-1'));
    const succeeded = unmute.mutateAsync(item('doc-2'));

    await vi.waitFor(() => {
      expect(cachedIds()).toEqual([]);
    });

    fail.resolve(httpError());
    await expect(failed).rejects.toThrow();
    expect(cachedIds()).toEqual(['doc-1']);

    succeed.resolve(ok({}));
    await succeeded;
    expect(cachedIds()).toEqual(['doc-1']);
  });
});

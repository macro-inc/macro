import { fireAndForget } from '@core/util/fireAndForget';
import { InfiniteQueryObserver } from '@tanstack/solid-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../client';
import { invalidateExternalChatMessages } from './index';
import { externalChatsKeys } from './keys';

type Page = { rows: string[]; before?: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('invalidateExternalChatMessages', () => {
  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
  });

  /** A send settling or a live push refetches while the viewer loads history. */
  it('keeps an older page that was loading when the refresh started', async () => {
    const older = deferred<Page>();
    const queryKey = externalChatsKeys.messages('user', 'chat').queryKey;
    const observer = new InfiniteQueryObserver(queryClient, {
      queryKey,
      queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
        pageParam
          ? older.promise
          : Promise.resolve<Page>({ rows: ['newest'], before: 'cursor' }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page: Page) => page.before,
    });
    const unsubscribe = observer.subscribe(() => {});
    await queryClient.getQueryCache().find({ queryKey })?.promise;

    const loading = observer.fetchNextPage();
    const refreshed = invalidateExternalChatMessages('user', 'chat');
    older.resolve({ rows: ['older'] });
    await Promise.all([loading, refreshed]);

    expect(
      observer.getCurrentResult().data?.pages.flatMap((page) => page.rows)
    ).toContain('older');
    unsubscribe();
  });

  /** The older page request has no timeout of its own, so it can hang. */
  it('refreshes once an older page has hung for too long', async () => {
    vi.useFakeTimers();
    const queryKey = externalChatsKeys.messages('user', 'chat').queryKey;
    let newestFetches = 0;
    const observer = new InfiniteQueryObserver(queryClient, {
      queryKey,
      queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
        if (pageParam) return new Promise<Page>(() => {});
        newestFetches += 1;
        return Promise.resolve<Page>({ rows: ['newest'], before: 'cursor' });
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page: Page) => page.before,
    });
    const unsubscribe = observer.subscribe(() => {});
    await queryClient.getQueryCache().find({ queryKey })?.promise;
    expect(newestFetches).toBe(1);

    fireAndForget(observer.fetchNextPage(), 'external-chat-test');
    const refreshed = invalidateExternalChatMessages('user', 'chat');
    await vi.advanceTimersByTimeAsync(60_000);
    await refreshed;

    expect(newestFetches).toBe(2);
    unsubscribe();
  });

  /** A quote click loads history too, replacing the fetch a refresh waits on. */
  it('does not cancel an older page that replaced the one it waited for', async () => {
    const pages = [deferred<Page>(), deferred<Page>()];
    let olderFetches = 0;
    const queryKey = externalChatsKeys.messages('user', 'chat').queryKey;
    const observer = new InfiniteQueryObserver(queryClient, {
      queryKey,
      queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
        if (!pageParam) {
          return Promise.resolve<Page>({ rows: ['newest'], before: 'cursor' });
        }
        olderFetches += 1;
        return pages[olderFetches - 1].promise;
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page: Page) => page.before,
    });
    const unsubscribe = observer.subscribe(() => {});
    await queryClient.getQueryCache().find({ queryKey })?.promise;

    const first = observer.fetchNextPage();
    const refreshed = invalidateExternalChatMessages('user', 'chat');
    const replacement = observer.fetchNextPage();
    // Let a waiter that doesn't look again reach its refetch.
    await new Promise((done) => setTimeout(done, 0));
    pages[1].resolve({ rows: ['older'] });
    await Promise.all([first, replacement, refreshed]);

    expect(
      observer.getCurrentResult().data?.pages.flatMap((page) => page.rows)
    ).toContain('older');
    unsubscribe();
  });
});

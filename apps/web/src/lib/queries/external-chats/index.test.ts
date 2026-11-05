import { InfiniteQueryObserver } from '@tanstack/solid-query';
import { afterEach, describe, expect, it } from 'vitest';
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
  afterEach(() => queryClient.clear());

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
});

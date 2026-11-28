import {
  networkRevalidated,
  networkRevalidationExchange,
} from '@graphql-cache/exchange/network-revalidation-exchange';
import {
  type Client,
  CombinedError,
  createClient,
  type GraphQLRequest,
  gql,
  type Operation,
  type OperationContext,
  type OperationResult,
} from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  empty,
  fromPromise,
  fromValue,
  makeSubject,
  mergeMap,
  onEnd,
  pipe,
} from 'wonka';
import { createUrqlInfiniteQuery } from './create-urql-infinite-query';
import { InfiniteQueryObserver } from './infinite-query-observer';
import { createPagedNetworkRevalidation } from './paged-network-revalidation';

type Page = {
  values: string[];
  nextCursor: string | null;
};
type Variables = { cursor: string | null };

type FakeExecution = {
  variables: Variables;
  next(data: Page): void;
  fail(error: CombinedError): void;
  readonly unsubscribed: boolean;
};

function makeFakeClient(): {
  client: Client;
  executions: FakeExecution[];
} {
  const executions: FakeExecution[] = [];
  const execute = (
    request: GraphQLRequest<Page, Variables>,
    context: Partial<OperationContext>
  ) => {
    const subject = makeSubject<OperationResult<Page, Variables>>();
    let unsubscribed = false;
    const operation = {
      kind: 'query',
      context,
    } as Operation<Page, Variables>;
    executions.push({
      variables: request.variables,
      next: (data) =>
        subject.next({ operation, data } as OperationResult<Page, Variables>),
      fail: (error) =>
        subject.next({ operation, error } as OperationResult<Page, Variables>),
      get unsubscribed() {
        return unsubscribed;
      },
    });
    return pipe(
      subject.source,
      onEnd(() => {
        unsubscribed = true;
      })
    );
  };

  return {
    executions,
    client: {
      executeQuery: execute,
    } as unknown as Client,
  };
}

const DOCUMENT = gql`
  query Page($cursor: String) {
    page(cursor: $cursor)
  }
`;

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.restoreAllMocks();
});

describe('createUrqlInfiniteQuery', () => {
  it('reselects when a live page changes without another result emission', () => {
    const fake = makeFakeClient();
    const [page, setPage] = createStore<Page>({
      values: ['a'],
      nextCursor: 'next',
    });
    createRoot((dispose) => {
      disposals.push(dispose);
      const query = createUrqlInfiniteQuery(() => ({
        client: fake.client,
        query: DOCUMENT,
        initialPageParam: null as string | null,
        variables: (cursor: string | null) => ({ cursor }),
        getNextPageParam: (page: Page) => page.nextCursor,
        select: ({ pages }: { pages: Page[] }) =>
          pages.flatMap((page) =>
            page.nextCursor === 'next' ? page.values : []
          ),
      }));
      fake.executions[0].next(page);
      expect(query.data).toEqual(['a']);
      setPage('nextCursor', null);
      expect(query.data).toEqual([]);
      setPage('nextCursor', 'next');
      expect(query.data).toEqual(['a']);
      expect(fake.executions).toHaveLength(1);
    });
  });

  it('caches immutable observer results between emissions', () => {
    const fake = makeFakeClient();
    let selectCalls = 0;
    const observer = new InfiniteQueryObserver<
      Page,
      Variables,
      string | null,
      string[]
    >(fake.client, {
      query: DOCUMENT,
      initialPageParam: null,
      variables: (cursor) => ({ cursor }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      select: ({ pages }) => {
        selectCalls += 1;
        return pages.flatMap((page) => page.values);
      },
    });

    const initial = observer.getCurrentResult();
    expect(observer.getCurrentResult()).toBe(initial);

    fake.executions[0]?.next({ values: ['first'], nextCursor: null });

    const updated = observer.getCurrentResult();
    expect(updated).not.toBe(initial);
    expect(observer.getCurrentResult()).toBe(updated);
    expect(selectCalls).toBe(1);

    const page = { values: ['same'], nextCursor: null };
    fake.executions[0]?.next(page);
    const selected = observer.getCurrentResult().data;
    expect(selectCalls).toBe(2);

    fake.executions[0]?.next(page);
    expect(observer.getCurrentResult().data).toBe(selected);
    expect(selectCalls).toBe(2);

    fake.executions[0]?.next({ ...page });
    expect(selectCalls).toBe(3);

    observer.destroy();
  });

  it('reselects unchanged pages when the selector changes', () => {
    const fake = makeFakeClient();
    const firstSelect = ({ pages }: { pages: Page[] }) =>
      pages.flatMap((page) => page.values);
    const observer = new InfiniteQueryObserver<
      Page,
      Variables,
      string | null,
      string[]
    >(fake.client, {
      query: DOCUMENT,
      initialPageParam: null,
      variables: (cursor) => ({ cursor }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      select: firstSelect,
    });

    fake.executions[0]?.next({ values: ['first'], nextCursor: null });
    const secondSelect = ({ pages }: { pages: Page[] }) =>
      pages.flatMap((page) => page.values.map((value) => `${value}-selected`));
    observer.setOptions(
      {
        query: DOCUMENT,
        initialPageParam: null,
        variables: (cursor) => ({ cursor }),
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        select: secondSelect,
      },
      fake.client
    );

    expect(observer.getCurrentResult().data).toEqual(['first-selected']);
    observer.destroy();
  });

  it('coalesces derivation while setting up the initial page', () => {
    const page = { values: ['cached'], nextCursor: null };
    let selectCalls = 0;
    let paginationCalls = 0;
    const client = {
      executeQuery: (
        _request: GraphQLRequest<Page, Variables>,
        context: Partial<OperationContext>
      ) => {
        const operation = {
          kind: 'query',
          context,
        } as Operation<Page, Variables>;
        return fromValue({ operation, data: page } as OperationResult<
          Page,
          Variables
        >);
      },
    } as unknown as Client;

    const observer = new InfiniteQueryObserver<
      Page,
      Variables,
      string | null,
      string[]
    >(client, {
      query: DOCUMENT,
      initialPageParam: null,
      variables: (cursor) => ({ cursor }),
      getNextPageParam: (lastPage) => {
        paginationCalls += 1;
        return lastPage.nextCursor;
      },
      select: ({ pages }) => {
        selectCalls += 1;
        return pages.flatMap((currentPage) => currentPage.values);
      },
    });

    expect(observer.getCurrentResult().data).toEqual(['cached']);
    expect(selectCalls).toBe(1);
    expect(paginationCalls).toBe(1);
    observer.destroy();
  });

  it('appends continuation pages while keeping loaded pages live', async () => {
    const fake = makeFakeClient();
    let query!: ReturnType<
      typeof createUrqlInfiniteQuery<Page, Variables, string | null, string[]>
    >;
    const dispose = createRoot((rootDispose) => {
      query = createUrqlInfiniteQuery<Page, Variables, string | null, string[]>(
        () => ({
          query: DOCUMENT,
          client: fake.client,
          initialPageParam: null,
          variables: (cursor) => ({ cursor }),
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          select: ({ pages }) => pages.flatMap((page) => page.values),
        })
      );
      return rootDispose;
    });
    disposals.push(dispose);

    expect(fake.executions).toHaveLength(1);
    fake.executions[0]?.next({ values: ['first'], nextCursor: 'cursor-1' });
    expect(query.data).toEqual(['first']);
    expect(query.hasNextPage).toBe(true);

    const nextPage = query.fetchNextPage();
    expect(fake.executions).toHaveLength(2);
    expect(fake.executions[1]?.variables).toEqual({ cursor: 'cursor-1' });
    fake.executions[1]?.next({ values: ['second'], nextCursor: null });
    await nextPage;

    expect(query.data).toEqual(['first', 'second']);
    expect(query.hasNextPage).toBe(false);

    fake.executions[0]?.next({
      values: ['first-updated'],
      nextCursor: 'cursor-1',
    });
    expect(query.data).toEqual(['first-updated', 'second']);
    expect(fake.executions[0]?.unsubscribed).toBe(false);
  });

  it('does not traverse retained page data on resets and option changes', () => {
    const fake = makeFakeClient();
    const [enabled, setEnabled] = createSignal(true);
    let query!: ReturnType<
      typeof createUrqlInfiniteQuery<Page, Variables, string | null>
    >;
    const dispose = createRoot((rootDispose) => {
      query = createUrqlInfiniteQuery<Page, Variables, string | null>(() => ({
        query: DOCUMENT,
        client: fake.client,
        enabled: enabled(),
        initialPageParam: null,
        variables: (cursor) => ({ cursor }),
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }));
      return rootDispose;
    });
    disposals.push(dispose);
    const page = { values: ['first'], nextCursor: null };
    fake.executions[0]?.next(page);
    const firstData = query.data;
    const descriptors = vi.spyOn(Object, 'getOwnPropertyDescriptors');

    query.resetToInitialPage();
    setEnabled(false);

    expect(query.isEnabled).toBe(false);
    expect(query.data).toBe(firstData);
    expect(fake.executions[0]?.unsubscribed).toBe(true);
    expect(descriptors).not.toHaveBeenCalledWith(page);
  });

  it('resets to the live initial page before refetching', async () => {
    const fake = makeFakeClient();
    let query!: ReturnType<
      typeof createUrqlInfiniteQuery<Page, Variables, string | null, string[]>
    >;
    const dispose = createRoot((rootDispose) => {
      query = createUrqlInfiniteQuery<Page, Variables, string | null, string[]>(
        () => ({
          query: DOCUMENT,
          client: fake.client,
          initialPageParam: null,
          variables: (cursor) => ({ cursor }),
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          select: ({ pages }) => pages.flatMap((page) => page.values),
        })
      );
      return rootDispose;
    });
    disposals.push(dispose);

    fake.executions[0]?.next({ values: ['first'], nextCursor: 'cursor-1' });
    const nextPage = query.fetchNextPage();
    fake.executions[1]?.next({ values: ['second'], nextCursor: null });
    await nextPage;

    query.resetToInitialPage();

    expect(query.data).toEqual(['first']);
    expect(query.hasNextPage).toBe(true);
    expect(fake.executions[0]?.unsubscribed).toBe(false);
    expect(fake.executions[1]?.unsubscribed).toBe(true);

    const refetch = query.refetch();
    expect(fake.executions).toHaveLength(3);
    expect(fake.executions[2]?.variables).toEqual({ cursor: null });
    fake.executions[2]?.next({
      values: ['first-refreshed'],
      nextCursor: null,
    });
    await refetch;

    expect(query.data).toEqual(['first-refreshed']);
    expect(fake.executions).toHaveLength(3);
  });

  it('keeps loaded pages mounted while a refetch rebuilds the cursor chain', async () => {
    const fake = makeFakeClient();
    let query!: ReturnType<
      typeof createUrqlInfiniteQuery<Page, Variables, string | null, string[]>
    >;
    const dispose = createRoot((rootDispose) => {
      query = createUrqlInfiniteQuery<Page, Variables, string | null, string[]>(
        () => ({
          query: DOCUMENT,
          client: fake.client,
          initialPageParam: null,
          variables: (cursor) => ({ cursor }),
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          select: ({ pages }) => pages.flatMap((page) => page.values),
        })
      );
      return rootDispose;
    });
    disposals.push(dispose);

    fake.executions[0]?.next({ values: ['first'], nextCursor: 'cursor-1' });
    const nextPage = query.fetchNextPage();
    fake.executions[1]?.next({ values: ['second'], nextCursor: null });
    await nextPage;
    expect(query.data).toEqual(['first', 'second']);

    const refetch = query.refetch();
    expect(fake.executions).toHaveLength(3);
    fake.executions[2]?.next({
      values: ['first-refreshed'],
      nextCursor: 'cursor-2',
    });
    await vi.waitFor(() => expect(fake.executions).toHaveLength(4));
    expect(fake.executions[3]?.variables).toEqual({ cursor: 'cursor-2' });
    expect(query.data).toEqual(['first-refreshed', 'second']);
    expect(fake.executions[1]?.unsubscribed).toBe(false);

    fake.executions[3]?.next({
      values: ['second-refreshed'],
      nextCursor: null,
    });
    await refetch;

    expect(query.data).toEqual(['first-refreshed', 'second-refreshed']);
    expect(fake.executions[1]?.unsubscribed).toBe(true);
    expect(query.hasNextPage).toBe(false);
  });

  it('keeps the stale page and reports the error when a replacement page fails', async () => {
    const fake = makeFakeClient();
    let query!: ReturnType<
      typeof createUrqlInfiniteQuery<Page, Variables, string | null, string[]>
    >;
    const dispose = createRoot((rootDispose) => {
      query = createUrqlInfiniteQuery<Page, Variables, string | null, string[]>(
        () => ({
          query: DOCUMENT,
          client: fake.client,
          initialPageParam: null,
          variables: (cursor) => ({ cursor }),
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          select: ({ pages }) => pages.flatMap((page) => page.values),
        })
      );
      return rootDispose;
    });
    disposals.push(dispose);

    fake.executions[0]?.next({ values: ['first'], nextCursor: 'cursor-1' });
    const nextPage = query.fetchNextPage();
    fake.executions[1]?.next({ values: ['second'], nextCursor: null });
    await nextPage;

    const refetch = query.refetch();
    fake.executions[2]?.next({
      values: ['first-refreshed'],
      nextCursor: 'cursor-2',
    });
    await vi.waitFor(() => expect(fake.executions).toHaveLength(4));
    const offline = new CombinedError({ networkError: new Error('offline') });
    fake.executions[3]?.fail(offline);
    await refetch;

    expect(query.data).toEqual(['first-refreshed', 'second']);
    expect(query.error).toBe(offline);
    expect(fake.executions[1]?.unsubscribed).toBe(false);
    expect(fake.executions[3]?.unsubscribed).toBe(true);

    const retry = query.refetch();
    fake.executions[4]?.next({
      values: ['first-refreshed'],
      nextCursor: 'cursor-2',
    });
    await vi.waitFor(() => expect(fake.executions).toHaveLength(6));
    fake.executions[5]?.next({
      values: ['second-refreshed'],
      nextCursor: null,
    });
    await retry;
    expect(query.error).toBeNull();
    expect(query.data).toEqual(['first-refreshed', 'second-refreshed']);
  });

  it('releases a pending replacement page as soon as the refetch is cancelled', async () => {
    const fake = makeFakeClient();
    let query!: ReturnType<
      typeof createUrqlInfiniteQuery<Page, Variables, string | null, string[]>
    >;
    const dispose = createRoot((rootDispose) => {
      query = createUrqlInfiniteQuery<Page, Variables, string | null, string[]>(
        () => ({
          query: DOCUMENT,
          client: fake.client,
          initialPageParam: null,
          variables: (cursor) => ({ cursor }),
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          select: ({ pages }) => pages.flatMap((page) => page.values),
        })
      );
      return rootDispose;
    });
    disposals.push(dispose);

    fake.executions[0]?.next({ values: ['first'], nextCursor: 'cursor-1' });
    const nextPage = query.fetchNextPage();
    fake.executions[1]?.next({ values: ['second'], nextCursor: null });
    await nextPage;

    const refetch = query.refetch();
    fake.executions[2]?.next({
      values: ['first-refreshed'],
      nextCursor: 'cursor-2',
    });
    await vi.waitFor(() => expect(fake.executions).toHaveLength(4));
    expect(fake.executions[3]?.unsubscribed).toBe(false);

    query.resetToInitialPage();
    expect(fake.executions[3]?.unsubscribed).toBe(true);
    await refetch;
    expect(query.data).toEqual(['first-refreshed']);
    expect(fake.executions).toHaveLength(4);
  });

  it('disables page subscriptions and re-enables them', () => {
    const fake = makeFakeClient();
    const [enabled, setEnabled] = createSignal(true);
    let query!: ReturnType<
      typeof createUrqlInfiniteQuery<Page, Variables, string | null, string[]>
    >;
    const dispose = createRoot((rootDispose) => {
      query = createUrqlInfiniteQuery<Page, Variables, string | null, string[]>(
        () => ({
          query: DOCUMENT,
          client: fake.client,
          enabled: enabled(),
          initialPageParam: null,
          variables: (cursor) => ({ cursor }),
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          select: ({ pages }) => pages.flatMap((page) => page.values),
        })
      );
      return rootDispose;
    });
    disposals.push(dispose);

    fake.executions[0]?.next({ values: ['first'], nextCursor: null });
    setEnabled(false);

    expect(query.isEnabled).toBe(false);
    expect(query.data).toEqual(['first']);
    expect(fake.executions[0]?.unsubscribed).toBe(true);

    setEnabled(true);

    expect(query.isEnabled).toBe(true);
    expect(query.data).toEqual(['first']);
    expect(fake.executions).toHaveLength(2);
  });

  it('retains selected data while a changed query loads', () => {
    const fake = makeFakeClient();
    const [initialPageParam, setInitialPageParam] = createSignal<string | null>(
      null
    );
    let query!: ReturnType<
      typeof createUrqlInfiniteQuery<Page, Variables, string | null, string[]>
    >;
    const dispose = createRoot((rootDispose) => {
      query = createUrqlInfiniteQuery<Page, Variables, string | null, string[]>(
        () => ({
          query: DOCUMENT,
          client: fake.client,
          initialPageParam: initialPageParam(),
          variables: (cursor) => ({ cursor }),
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          select: ({ pages }) => pages.flatMap((page) => page.values),
        })
      );
      return rootDispose;
    });
    disposals.push(dispose);

    fake.executions[0]?.next({ values: ['first'], nextCursor: null });
    expect(query.data).toEqual(['first']);

    setInitialPageParam('replacement');

    expect(fake.executions).toHaveLength(2);
    expect(fake.executions[0]?.unsubscribed).toBe(true);
    expect(query.data).toEqual(['first']);

    fake.executions[1]?.next({ values: ['replacement'], nextCursor: null });
    expect(query.data).toEqual(['replacement']);
  });

  it('exposes selector failures without interrupting page delivery', () => {
    const fake = makeFakeClient();
    let query!: ReturnType<
      typeof createUrqlInfiniteQuery<Page, Variables, string | null, string[]>
    >;
    const dispose = createRoot((rootDispose) => {
      query = createUrqlInfiniteQuery<Page, Variables, string | null, string[]>(
        () => ({
          query: DOCUMENT,
          client: fake.client,
          initialPageParam: null,
          variables: (cursor) => ({ cursor }),
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          select: () => {
            throw new Error('selector failed');
          },
        })
      );
      return rootDispose;
    });
    disposals.push(dispose);

    expect(() =>
      fake.executions[0]?.next({ values: ['first'], nextCursor: 'cursor-1' })
    ).not.toThrow();
    expect(query.error?.networkError?.message).toBe('selector failed');
    expect(query.isError).toBe(true);
    expect(query.hasNextPage).toBe(false);
  });

  it('exposes pagination callback failures without interrupting delivery', () => {
    const fake = makeFakeClient();
    let query!: ReturnType<
      typeof createUrqlInfiniteQuery<Page, Variables, string | null, string[]>
    >;
    const dispose = createRoot((rootDispose) => {
      query = createUrqlInfiniteQuery<Page, Variables, string | null, string[]>(
        () => ({
          query: DOCUMENT,
          client: fake.client,
          initialPageParam: null,
          variables: (cursor) => ({ cursor }),
          getNextPageParam: () => {
            throw new Error('pagination failed');
          },
          select: ({ pages }) => pages.flatMap((page) => page.values),
        })
      );
      return rootDispose;
    });
    disposals.push(dispose);

    expect(() =>
      fake.executions[0]?.next({ values: ['first'], nextCursor: 'cursor-1' })
    ).not.toThrow();
    expect(query.data).toEqual(['first']);
    expect(query.error?.networkError?.message).toBe('pagination failed');
    expect(query.isError).toBe(true);
    expect(query.hasNextPage).toBe(false);
  });
});

describe('createUrqlInfiniteQuery under the revalidation exchange', () => {
  const LIST = gql`
    query List($cursor: String) {
      page(cursor: $cursor)
    }
  `;
  const ARCHIVE = gql`
    mutation Archive {
      archive
    }
  `;

  /** A server listing `rows` two at a time, after the row named by a cursor. */
  function serve(rows: string[], { failReadsAfterWrite = false } = {}) {
    const reads: (string | null)[] = [];
    let written = false;
    const client = createClient({
      url: 'http://test/graphql',
      exchanges: [
        networkRevalidationExchange(),
        () => (operations$) =>
          pipe(
            operations$,
            mergeMap((operation) => {
              if (operation.kind === 'teardown') return empty;
              if (operation.kind === 'mutation') {
                rows.shift();
                written = true;
              }
              if (operation.kind === 'query' && failReadsAfterWrite && written)
                return fromPromise(
                  Promise.resolve({
                    operation,
                    error: new CombinedError({
                      networkError: new Error('offline'),
                    }),
                    stale: false,
                    hasNext: false,
                  } as OperationResult)
                );
              const cursor: string | null = operation.variables?.cursor ?? null;
              if (operation.kind === 'query') reads.push(cursor);
              const start = cursor === null ? 0 : rows.indexOf(cursor) + 1;
              const values = rows.slice(start, start + 2);
              const data =
                operation.kind === 'mutation'
                  ? { archive: true }
                  : {
                      page: {
                        values,
                        nextCursor:
                          start + 2 < rows.length ? values.at(-1) : null,
                      },
                    };
              return fromPromise(
                Promise.resolve({
                  operation,
                  data,
                  stale: false,
                  hasNext: false,
                } as OperationResult)
              );
            })
          ),
      ],
    });
    return { client, reads };
  }

  it('reads a scrolled list again in cursor order after a write', async () => {
    const server = serve(['a', 'b', 'c', 'd', 'e']);
    await createRoot(async (dispose) => {
      disposals.push(dispose);
      // As a Soup list does: its pages are read again through its own chain.
      const networkRevalidation = createPagedNetworkRevalidation(() => query, {
        client: () => server.client,
        chain: () => null,
        reads: () => true,
      });
      const query = createUrqlInfiniteQuery(() => ({
        client: server.client,
        query: LIST,
        initialPageParam: null as string | null,
        context: { networkRevalidation: networkRevalidation() },
        variables: (cursor: string | null) => ({ cursor }),
        getNextPageParam: (data: { page: Page }) => data.page.nextCursor,
        select: ({ pages }: { pages: { page: Page }[] }) =>
          pages.flatMap((data) => data.page.values),
      }));
      await vi.waitFor(() => expect(query.data).toEqual(['a', 'b']));
      await query.fetchNextPage();
      expect(query.data).toEqual(['a', 'b', 'c', 'd']);
      server.reads.length = 0;

      // Removing the first row moves the page boundary from b to c.
      await server.client.mutation(ARCHIVE, {}).toPromise();

      // Re-sending page 2 after b would show c twice.
      expect(query.data).toEqual(['b', 'c', 'd', 'e']);
      expect(server.reads).toEqual([null, 'c']);
    });
  });

  it('does not report a write as read again when the list read fails', async () => {
    const server = serve(['a', 'b', 'c'], { failReadsAfterWrite: true });
    await createRoot(async (dispose) => {
      disposals.push(dispose);
      const networkRevalidation = createPagedNetworkRevalidation(() => query, {
        client: () => server.client,
        chain: () => null,
        reads: () => true,
      });
      const query = createUrqlInfiniteQuery(() => ({
        client: server.client,
        query: LIST,
        initialPageParam: null as string | null,
        context: { networkRevalidation: networkRevalidation() },
        variables: (cursor: string | null) => ({ cursor }),
        getNextPageParam: (data: { page: Page }) => data.page.nextCursor,
        select: ({ pages }: { pages: { page: Page }[] }) =>
          pages.flatMap((data) => data.page.values),
      }));
      await vi.waitFor(() => expect(query.data).toEqual(['a', 'b']));

      const result = await server.client.mutation(ARCHIVE, {}).toPromise();

      // A caller that would read the list itself must still do so.
      expect(result.data).toEqual({ archive: true });
      expect(networkRevalidated(result)).toBe(false);
    });
  });

  it('reads both copies of a list mounted twice', async () => {
    const server = serve(['a', 'b', 'c', 'd', 'e']);
    await createRoot(async (dispose) => {
      disposals.push(dispose);
      const mountList = () => {
        const networkRevalidation = createPagedNetworkRevalidation(
          () => query,
          {
            client: () => server.client,
            chain: () => null,
            reads: () => true,
          }
        );
        const query = createUrqlInfiniteQuery(() => ({
          client: server.client,
          query: LIST,
          initialPageParam: null as string | null,
          context: { networkRevalidation: networkRevalidation() },
          variables: (cursor: string | null) => ({ cursor }),
          getNextPageParam: (data: { page: Page }) => data.page.nextCursor,
          select: ({ pages }: { pages: { page: Page }[] }) =>
            pages.flatMap((data) => data.page.values),
        }));
        return query;
      };
      const lists = [mountList(), mountList()];
      for (const list of lists) {
        await vi.waitFor(() => expect(list.data).toEqual(['a', 'b']));
        await list.fetchNextPage();
      }
      expect(lists[1].data).toEqual(['a', 'b', 'c', 'd']);

      await server.client.mutation(ARCHIVE, {}).toPromise();

      // Each list re-reads its own chain, though they share page keys.
      for (const list of lists) expect(list.data).toEqual(['b', 'c', 'd', 'e']);
    });
  });

  it('reads again after a refetch that started before the write', async () => {
    const server = serve(['a', 'b', 'c', 'd', 'e']);
    await createRoot(async (dispose) => {
      disposals.push(dispose);
      const before = vi.fn();
      const networkRevalidation = createPagedNetworkRevalidation(() => query, {
        client: () => server.client,
        chain: () => null,
        reads: () => true,
        before,
      });
      const query = createUrqlInfiniteQuery(() => ({
        client: server.client,
        query: LIST,
        initialPageParam: null as string | null,
        context: { networkRevalidation: networkRevalidation() },
        variables: (cursor: string | null) => ({ cursor }),
        getNextPageParam: (data: { page: Page }) => data.page.nextCursor,
        select: ({ pages }: { pages: { page: Page }[] }) =>
          pages.flatMap((data) => data.page.values),
      }));
      await vi.waitFor(() => expect(query.data).toEqual(['a', 'b']));
      await query.fetchNextPage();

      server.reads.length = 0;

      // A refetch reads the first page before the write commits.
      const earlier = query.refetch({ requestPolicy: 'network-only' });
      await server.client.mutation(ARCHIVE, {}).toPromise();
      await earlier;

      expect(query.data).toEqual(['b', 'c', 'd', 'e']);
      // The earlier chain, then the owner's own after it: no third read.
      expect(server.reads).toEqual([null, 'b', null, 'c']);
      expect(before).toHaveBeenCalledOnce();
    });
  });

  it('leaves a page the list moved away from to its other reader', async () => {
    const server = serve(['a', 'b', 'c', 'd', 'e']);
    await createRoot(async (dispose) => {
      disposals.push(dispose);
      const [filter, setFilter] = createSignal('all');
      const networkRevalidation = createPagedNetworkRevalidation(() => query, {
        client: () => server.client,
        chain: filter,
        reads: () => true,
      });
      const query = createUrqlInfiniteQuery(() => ({
        client: server.client,
        query: LIST,
        initialPageParam: null as string | null,
        context: { networkRevalidation: networkRevalidation() },
        variables: (cursor: string | null) => ({ cursor, filter: filter() }),
        getNextPageParam: (data: { page: Page }) => data.page.nextCursor,
        select: ({ pages }: { pages: { page: Page }[] }) =>
          pages.flatMap((data) => data.page.values),
      }));
      await vi.waitFor(() => expect(query.data).toEqual(['a', 'b']));
      // Another reader keeps the list's first page mounted.
      const other: unknown[] = [];
      const reader = server.client
        .query(LIST, { cursor: null, filter: 'all' })
        .subscribe((result) => other.push(result.data));
      await vi.waitFor(() => expect(other).toHaveLength(1));
      setFilter('mine');
      await vi.waitFor(() => expect(server.reads).toHaveLength(3));
      server.reads.length = 0;

      await server.client.mutation(ARCHIVE, {}).toPromise();

      // The list reads its new chain; the page it left is re-sent.
      expect(server.reads).toEqual([null, null]);
      expect(other.at(-1)).toEqual({
        page: { values: ['b', 'c'], nextCursor: 'c' },
      });
      reader.unsubscribe();
    });
  });

  it('keeps a paused list from reading the network after a write', async () => {
    const server = serve(['a', 'b', 'c']);
    await createRoot(async (dispose) => {
      disposals.push(dispose);
      const [paused, setPaused] = createSignal(false);
      const before = vi.fn();
      const networkRevalidation = createPagedNetworkRevalidation(() => query, {
        client: () => server.client,
        chain: () => null,
        reads: () => !paused(),
        before,
      });
      const query = createUrqlInfiniteQuery(() => ({
        client: server.client,
        query: LIST,
        initialPageParam: null as string | null,
        context: { networkRevalidation: networkRevalidation() },
        requestPolicy: paused() ? 'cache-only' : 'cache-and-network',
        variables: (cursor: string | null) => ({ cursor }),
        getNextPageParam: (data: { page: Page }) => data.page.nextCursor,
        select: ({ pages }: { pages: { page: Page }[] }) =>
          pages.flatMap((data) => data.page.values),
      }));
      await vi.waitFor(() => expect(query.data).toEqual(['a', 'b']));
      setPaused(true);
      server.reads.length = 0;
      // A reader sharing its page key would otherwise have it read the
      // network through this owner.
      expect(networkRevalidation().active()).toBe(false);

      await server.client.mutation(ARCHIVE, {}).toPromise();

      expect(server.reads).toEqual([]);
      expect(before).not.toHaveBeenCalled();
    });
  });

  it('reads a list whose requests urql joined onto another list', async () => {
    const server = serve(['a', 'b', 'c', 'd', 'e']);
    await createRoot(async (dispose) => {
      disposals.push(dispose);
      const mountList = () => {
        const networkRevalidation = createPagedNetworkRevalidation(
          () => query,
          {
            client: () => server.client,
            chain: () => null,
            reads: () => true,
          }
        );
        const query = createUrqlInfiniteQuery(() => ({
          client: server.client,
          query: LIST,
          initialPageParam: null as string | null,
          context: { networkRevalidation: networkRevalidation() },
          variables: (cursor: string | null) => ({ cursor }),
          getNextPageParam: (data: { page: Page }) => data.page.nextCursor,
          select: ({ pages }: { pages: { page: Page }[] }) =>
            pages.flatMap((data) => data.page.values),
        }));
        return query;
      };
      // Mounted together, the second list's pages join the first's requests,
      // so its operations (and its owner) never reach the exchange.
      const lists = [mountList(), mountList()];
      for (const list of lists) {
        await vi.waitFor(() => expect(list.data).toEqual(['a', 'b']));
      }
      await Promise.all(lists.map((list) => list.fetchNextPage()));
      for (const list of lists) expect(list.data).toEqual(['a', 'b', 'c', 'd']);

      await server.client.mutation(ARCHIVE, {}).toPromise();

      for (const list of lists) expect(list.data).toEqual(['b', 'c', 'd', 'e']);
    });
  });

  it('never lets a refetch that throws join one that keeps its failures', async () => {
    const server = serve(['a', 'b', 'c']);
    await createRoot(async (dispose) => {
      disposals.push(dispose);
      const query = createUrqlInfiniteQuery(() => ({
        client: server.client,
        query: LIST,
        initialPageParam: null as string | null,
        variables: (cursor: string | null) => ({ cursor }),
        getNextPageParam: (data: { page: Page }) => data.page.nextCursor,
        select: ({ pages }: { pages: { page: Page }[] }) =>
          pages.flatMap((data) => data.page.values),
      }));
      await vi.waitFor(() => expect(query.data).toEqual(['a', 'b']));
      server.reads.length = 0;

      const loose = query.refetch({ requestPolicy: 'network-only' });
      const strict = query.refetch({
        requestPolicy: 'network-only',
        throwOnError: true,
      });
      const looseAgain = query.refetch({ requestPolicy: 'network-only' });
      await Promise.all([loose, strict, looseAgain]);

      // The strict caller reads after the loose one; a loose caller joins.
      expect(server.reads).toEqual([null, null]);
    });
  });
});

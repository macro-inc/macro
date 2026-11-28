import {
  type Client,
  CombinedError,
  type GraphQLRequest,
  gql,
  type Operation,
  type OperationContext,
  type OperationResult,
} from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fromValue, makeSubject, onEnd, pipe } from 'wonka';
import { createUrqlInfiniteQuery } from './create-urql-infinite-query';
import { InfiniteQueryObserver } from './infinite-query-observer';

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

/**
 * Two loaded pages, `b, member` then `c`, from a query that repairs its
 * cursor chain while `repairs` holds.
 */
async function twoPagesRepairedWhile(repairs: () => boolean) {
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
        repairContinuations: repairs(),
      })
    );
    return rootDispose;
  });
  disposals.push(dispose);

  fake.executions[0]?.next({
    values: ['b', 'member'],
    nextCursor: 'after-member',
  });
  const nextPage = query.fetchNextPage();
  fake.executions[1]?.next({ values: ['c'], nextCursor: null });
  await nextPage;
  expect(query.data).toEqual(['b', 'member', 'c']);
  return { fake, query };
}

/**
 * A new row tops the first page and pushes `member` onto the next one, past
 * where that page's saved cursor starts.
 */
function pushMemberAcross(fake: ReturnType<typeof makeFakeClient>) {
  fake.executions[0]?.next({ values: ['new', 'b'], nextCursor: 'after-b' });
}
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

  it('reads a later page again from where the page before it now ends', async () => {
    const { fake, query } = await twoPagesRepairedWhile(() => true);

    pushMemberAcross(fake);
    await vi.waitFor(() => expect(fake.executions).toHaveLength(3));
    expect(fake.executions[2]?.variables).toEqual({ cursor: 'after-b' });
    // The stale page stays until its replacement lands.
    expect(query.data).toEqual(['new', 'b', 'c']);
    expect(query.isFetching).toBe(true);

    fake.executions[2]?.next({ values: ['member', 'c'], nextCursor: null });
    await vi.waitFor(() =>
      expect(query.data).toEqual(['new', 'b', 'member', 'c'])
    );
    expect(fake.executions[1]?.unsubscribed).toBe(true);
    expect(query.isFetching).toBe(false);
    expect(fake.executions).toHaveLength(3);
  });

  it('leaves a broken cursor chain alone until repairs are on', async () => {
    const [repairs, setRepairs] = createSignal(false);
    const { fake, query } = await twoPagesRepairedWhile(repairs);

    pushMemberAcross(fake);
    await Promise.resolve();
    expect(fake.executions).toHaveLength(2);
    expect(query.data).toEqual(['new', 'b', 'c']);

    setRepairs(true);
    await vi.waitFor(() => expect(fake.executions).toHaveLength(3));
    expect(fake.executions[2]?.variables).toEqual({ cursor: 'after-b' });
    fake.executions[2]?.next({ values: ['member', 'c'], nextCursor: null });
    await vi.waitFor(() =>
      expect(query.data).toEqual(['new', 'b', 'member', 'c'])
    );
  });

  it('drops the pages after one that now ends the list', async () => {
    const { fake, query } = await twoPagesRepairedWhile(() => true);

    fake.executions[0]?.next({
      values: ['b', 'member', 'c'],
      nextCursor: null,
    });
    await vi.waitFor(() => expect(query.data).toEqual(['b', 'member', 'c']));
    expect(fake.executions[1]?.unsubscribed).toBe(true);
    expect(fake.executions).toHaveLength(2);
    expect(query.hasNextPage).toBe(false);
  });

  it('keeps the stale page when a repair fails and tries again on the next read', async () => {
    const { fake, query } = await twoPagesRepairedWhile(() => true);

    pushMemberAcross(fake);
    await vi.waitFor(() => expect(fake.executions).toHaveLength(3));
    const offline = new CombinedError({ networkError: new Error('offline') });
    fake.executions[2]?.fail(offline);
    await vi.waitFor(() => expect(query.error).toBe(offline));
    expect(query.data).toEqual(['new', 'b', 'c']);
    expect(fake.executions[1]?.unsubscribed).toBe(false);

    pushMemberAcross(fake);
    await vi.waitFor(() => expect(fake.executions).toHaveLength(4));
    fake.executions[3]?.next({ values: ['member', 'c'], nextCursor: null });
    await vi.waitFor(() =>
      expect(query.data).toEqual(['new', 'b', 'member', 'c'])
    );
    expect(query.error).toBeNull();
  });

  it('asks for the next page from the end of a repaired chain', async () => {
    const fake = makeFakeClient();
    let query!: ReturnType<
      typeof createUrqlInfiniteQuery<Page, Variables, string | null, string[]>
    >;
    disposals.push(
      createRoot((dispose) => {
        query = createUrqlInfiniteQuery<
          Page,
          Variables,
          string | null,
          string[]
        >(() => ({
          query: DOCUMENT,
          client: fake.client,
          initialPageParam: null,
          variables: (cursor) => ({ cursor }),
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          select: ({ pages }) => pages.flatMap((page) => page.values),
          repairContinuations: true,
        }));
        return dispose;
      })
    );
    fake.executions[0]?.next({
      values: ['b', 'member'],
      nextCursor: 'after-member',
    });
    const secondPage = query.fetchNextPage();
    fake.executions[1]?.next({ values: ['c'], nextCursor: 'after-c' });
    await secondPage;

    pushMemberAcross(fake);
    await vi.waitFor(() => expect(fake.executions).toHaveLength(3));
    const thirdPage = query.fetchNextPage();
    await Promise.resolve();
    // The next page waits for the repair, which may move where it starts.
    expect(fake.executions).toHaveLength(3);

    fake.executions[2]?.next({
      values: ['member', 'c'],
      nextCursor: 'after-c',
    });
    await vi.waitFor(() => expect(fake.executions).toHaveLength(4));
    expect(fake.executions[3]?.variables).toEqual({ cursor: 'after-c' });
    fake.executions[3]?.next({ values: ['d'], nextCursor: null });
    await thirdPage;
    expect(query.data).toEqual(['new', 'b', 'member', 'c', 'd']);
  });

  it('stops a repair when the list goes back to its first page', async () => {
    const { fake, query } = await twoPagesRepairedWhile(() => true);

    pushMemberAcross(fake);
    await vi.waitFor(() => expect(fake.executions).toHaveLength(3));
    query.resetToInitialPage();
    expect(fake.executions[2]?.unsubscribed).toBe(true);
    expect(query.data).toEqual(['new', 'b']);
    expect(query.isFetching).toBe(false);
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

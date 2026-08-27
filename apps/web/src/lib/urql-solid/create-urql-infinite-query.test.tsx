import {
  type Client,
  type GraphQLRequest,
  gql,
  type Operation,
  type OperationContext,
  type OperationResult,
} from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
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
});

describe('createUrqlInfiniteQuery', () => {
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

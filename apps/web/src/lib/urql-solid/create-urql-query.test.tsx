import {
  type AnyVariables,
  type Client,
  CombinedError,
  type GraphQLRequest,
  gql,
  type Operation,
  type OperationContext,
  type OperationResult,
} from '@urql/core';
import {
  type Accessor,
  createComponent,
  createRenderEffect,
  createRoot,
  createSignal,
} from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fromValue, makeSubject, onEnd, pipe } from 'wonka';
import { UrqlProvider } from './context';
import { createUrqlQuery } from './create-urql-query';
import type {
  UrqlClientSource,
  UrqlQueryOptions,
  UrqlQueryResult,
} from './types';

type Data = {
  value: string;
  nested?: { count: number; removed?: string };
};
type Variables = { input: string };
type RuntimeResult<D, V extends AnyVariables> = Omit<
  Partial<OperationResult<D, V>>,
  'data'
> & {
  data?: D | null;
};

type FakeExecution<D, V extends AnyVariables> = {
  document: unknown;
  variables: V;
  context: Partial<OperationContext>;
  next(result: RuntimeResult<D, V>): void;
  complete(): void;
  readonly unsubscribed: boolean;
};

function makeFakeClient<D = Data, V extends AnyVariables = Variables>(): {
  client: Client;
  executions: FakeExecution<D, V>[];
} {
  const executions: FakeExecution<D, V>[] = [];
  const execute = (
    document: unknown,
    variables: V,
    context: Partial<OperationContext> = {}
  ) => {
    const subject = makeSubject<OperationResult<D, V>>();
    let unsubscribed = false;
    const operation = {
      kind: 'query',
      context,
    } as Operation<D, V>;
    const execution: FakeExecution<D, V> = {
      document,
      variables,
      context,
      next: (result) =>
        subject.next({ operation, ...result } as OperationResult<D, V>),
      complete: subject.complete,
      get unsubscribed() {
        return unsubscribed;
      },
    };
    executions.push(execution);
    return pipe(
      subject.source,
      onEnd(() => {
        unsubscribed = true;
      })
    );
  };
  const client = {
    query: execute,
    executeQuery: (
      request: GraphQLRequest<D, V>,
      context: Partial<OperationContext> = {}
    ) => execute(request.query, request.variables, context),
  } as unknown as Client;
  return { client, executions };
}

const DOCUMENT = gql`
  query TestQuery($input: String!) {
    test(input: $input)
  }
`;
const OTHER_DOCUMENT = gql`
  query OtherTestQuery($input: String!) {
    otherTest(input: $input)
  }
`;

const disabledWithoutVariables: UrqlQueryOptions<Data, Variables> = {
  query: DOCUMENT,
  enabled: false,
};
// @ts-expect-error Enabled requests retain generated variables requirements.
const enabledWithoutVariables: UrqlQueryOptions<Data, Variables> = {
  query: DOCUMENT,
  enabled: true,
};
void disabledWithoutVariables;
void enabledWithoutVariables;

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.restoreAllMocks();
});

function setup(
  getOptions: Accessor<UrqlQueryOptions<Data, Variables>>,
  provider?: UrqlClientSource
): UrqlQueryResult<Data, Variables> {
  let query!: UrqlQueryResult<Data, Variables>;
  const dispose = createRoot((rootDispose) => {
    if (provider) {
      createComponent(UrqlProvider, {
        client: provider,
        get children() {
          query = createUrqlQuery(getOptions);
          return undefined;
        },
      });
    } else {
      query = createUrqlQuery(getOptions);
    }
    return rootDispose;
  });
  disposals.push(dispose);
  return query;
}

function activeOptions(client?: Client): UrqlQueryOptions<Data, Variables> {
  return {
    query: DOCUMENT,
    variables: { input: 'first' },
    client,
  };
}

describe('createUrqlQuery client resolution', () => {
  it('uses the provider and reactively follows provider client changes', () => {
    const first = makeFakeClient();
    const second = makeFakeClient();
    const [providerClient, setProviderClient] = createSignal(first.client);
    setup(() => activeOptions(), providerClient);

    expect(first.executions).toHaveLength(1);
    setProviderClient(() => second.client);

    expect(first.executions[0]?.unsubscribed).toBe(true);
    expect(second.executions).toHaveLength(1);
  });

  it('uses the nearest provider', () => {
    const outer = makeFakeClient();
    const inner = makeFakeClient();
    const dispose = createRoot((rootDispose) => {
      createComponent(UrqlProvider, {
        client: outer.client,
        get children() {
          return createComponent(UrqlProvider, {
            client: inner.client,
            get children() {
              createUrqlQuery<Data, Variables>(() => activeOptions());
              return undefined;
            },
          });
        },
      });
      return rootDispose;
    });
    disposals.push(dispose);

    expect(outer.executions).toHaveLength(0);
    expect(inner.executions).toHaveLength(1);
  });

  it('prefers an optional override and reactively returns to the provider', () => {
    const provided = makeFakeClient();
    const overridden = makeFakeClient();
    const [override, setOverride] = createSignal<Client | undefined>(undefined);
    setup(
      () => ({
        ...activeOptions(),
        client: override(),
      }),
      provided.client
    );

    expect(provided.executions).toHaveLength(1);
    setOverride(() => overridden.client);
    expect(provided.executions[0]?.unsubscribed).toBe(true);
    expect(overridden.executions).toHaveLength(1);

    setOverride(undefined);
    expect(overridden.executions[0]?.unsubscribed).toBe(true);
    expect(provided.executions).toHaveLength(2);
  });

  it('throws clearly without a provider or override', () => {
    expect(() => setup(() => activeOptions())).toThrow(
      'createUrqlQuery requires an UrqlProvider or a client option override'
    );
  });
});

describe('createUrqlQuery reactive state', () => {
  it('tracks cache, network, and pushed results over one live source', () => {
    const fake = makeFakeClient();
    const query = setup(() => activeOptions(fake.client));
    const execution = fake.executions[0];

    expect(query.status).toBe('pending');
    expect(query.fetchStatus).toBe('fetching');
    expect(query.fetching).toBe(true);
    expect(query.isEnabled).toBe(true);
    expect(query.isPending).toBe(true);
    expect(query.isLoading).toBe(true);
    expect(query.isInitialLoading).toBe(true);
    expect(query.isFetched).toBe(false);

    execution?.next({
      data: { value: 'cache' },
      stale: true,
      extensions: { tier: 'cache' },
    });
    expect(query.data).toEqual({ value: 'cache' });
    expect(query.status).toBe('success');
    expect(query.fetching).toBe(false);
    expect(query.isFetching).toBe(true);
    expect(query.isRefetching).toBe(true);
    expect(query.stale).toBe(true);
    expect(query.extensions).toEqual({ tier: 'cache' });

    execution?.next({ data: { value: 'network' }, stale: false });
    expect(query.data).toEqual({ value: 'network' });
    expect(query.fetchStatus).toBe('idle');
    expect(query.isSuccess).toBe(true);
    expect(query.isFetched).toBe(true);

    execution?.next({ data: { value: 'pushed' } });
    expect(query.data).toEqual({ value: 'pushed' });
    expect(fake.executions).toHaveLength(1);
  });

  it('marks a completed data-less result as successful', () => {
    const fake = makeFakeClient();
    const query = setup(() => activeOptions(fake.client));

    fake.executions[0]?.next({});

    expect(query.data).toBeUndefined();
    expect(query.status).toBe('success');
    expect(query.isFetched).toBe(true);
    expect(query.isLoading).toBe(false);
  });

  it('replaces subscriptions when query, variables, or context change', () => {
    const fake = makeFakeClient();
    const [input, setInput] = createSignal('first');
    const [document, setDocument] = createSignal(DOCUMENT);
    const [header, setHeader] = createSignal('one');
    const query = setup(() => ({
      query: document(),
      variables: { input: input() },
      context: { fetchOptions: { headers: { 'x-test': header() } } },
      client: fake.client,
    }));

    fake.executions[0]?.next({ data: { value: 'first' } });
    setInput('second');
    expect(fake.executions[0]?.unsubscribed).toBe(true);
    expect(fake.executions[1]?.variables).toEqual({ input: 'second' });

    fake.executions[0]?.next({ data: { value: 'late' } });
    expect(query.data).toEqual({ value: 'first' });

    setHeader('two');
    expect(fake.executions[1]?.unsubscribed).toBe(true);
    expect(fake.executions[2]?.context.fetchOptions).toEqual({
      headers: { 'x-test': 'two' },
    });

    setDocument(OTHER_DOCUMENT);
    expect(fake.executions[2]?.unsubscribed).toBe(true);
    expect(fake.executions[3]?.document).toBe(OTHER_DOCUMENT);
  });

  it('disables synchronously, preserves state, and re-enables', () => {
    const fake = makeFakeClient();
    const [enabled, setEnabled] = createSignal(true);
    const query = setup(() => ({
      query: DOCUMENT,
      variables: { input: 'first' },
      client: fake.client,
      enabled: enabled(),
    }));

    fake.executions[0]?.next({
      data: { value: 'existing' },
      stale: true,
      hasNext: true,
    });
    setEnabled(false);
    expect(fake.executions[0]?.unsubscribed).toBe(true);
    expect(query.isEnabled).toBe(false);
    expect(query.fetchStatus).toBe('idle');
    expect(query.stale).toBe(false);
    expect(query.hasNext).toBe(false);
    expect(query.data).toEqual({ value: 'existing' });

    fake.executions[0]?.next({ data: { value: 'late' } });
    expect(query.data).toEqual({ value: 'existing' });

    setEnabled(true);
    expect(query.isEnabled).toBe(true);
    expect(query.isRefetching).toBe(true);
    expect(fake.executions).toHaveLength(2);
  });

  it('clears prior result state for a new identity when configured', () => {
    const fake = makeFakeClient();
    const [input, setInput] = createSignal('first');
    const query = setup(() => ({
      query: DOCUMENT,
      variables: { input: input() },
      client: fake.client,
      keepPreviousData: false,
    }));
    const priorError = new CombinedError({ graphQLErrors: ['old error'] });

    fake.executions[0]?.next({
      data: { value: 'first' },
      error: priorError,
      stale: true,
    });
    setInput('second');

    expect(query.data).toBeUndefined();
    expect(query.error).toBeNull();
    expect(query.stale).toBe(false);
    expect(query.status).toBe('pending');
    expect(query.isLoading).toBe(true);
  });

  it('retains valid data while exposing partial and root-null errors', () => {
    const fake = makeFakeClient();
    const query = setup(() => activeOptions(fake.client));
    const partialError = new CombinedError({ graphQLErrors: ['partial'] });
    const rootError = new CombinedError({ graphQLErrors: ['root null'] });

    fake.executions[0]?.next({
      data: { value: 'partial-data' },
      error: partialError,
    });
    expect(query.data).toEqual({ value: 'partial-data' });
    expect(query.error).toBe(partialError);
    expect(query.isError).toBe(true);

    fake.executions[0]?.next({ data: { value: 'valid' } });
    fake.executions[0]?.next({ data: null, error: rootError });
    expect(query.data).toEqual({ value: 'valid' });
    expect(query.error).toBe(rootError);
    expect(query.status).toBe('error');
  });

  it('calls the result observer after updating state', () => {
    const fake = makeFakeClient();
    let observed: string | undefined;
    let query!: UrqlQueryResult<Data, Variables>;
    query = setup(() => ({
      ...activeOptions(fake.client),
      onResult: () => {
        observed = query.data?.value;
      },
    }));

    fake.executions[0]?.next({ data: { value: 'observed' } });
    expect(observed).toBe('observed');
  });

  it('returns a stable proxy backed by deeply reactive reconciled data', () => {
    const fake = makeFakeClient();
    const observed: Array<[number | undefined, string | undefined]> = [];
    let query!: UrqlQueryResult<Data, Variables>;
    const dispose = createRoot((rootDispose) => {
      query = createUrqlQuery(() => activeOptions(fake.client));
      createRenderEffect(() => {
        observed.push([query.data?.nested?.count, query.data?.nested?.removed]);
      });
      return rootDispose;
    });
    disposals.push(dispose);

    fake.executions[0]?.next({
      data: { value: 'first', nested: { count: 1, removed: 'old' } },
    });
    const firstData = query.data;
    expect(observed.at(-1)).toEqual([1, 'old']);

    fake.executions[0]?.next({
      data: { value: 'second', nested: { count: 2 } },
    });
    expect(query.data).toBe(firstData);
    expect(observed.at(-1)).toEqual([2, undefined]);
  });

  it('normalizes stale and incremental state when a source completes', () => {
    const fake = makeFakeClient();
    const query = setup(() => activeOptions(fake.client));

    fake.executions[0]?.next({
      data: { value: 'partial' },
      stale: true,
      hasNext: true,
    });
    expect(query.fetching).toBe(false);
    expect(query.isFetching).toBe(true);
    expect(query.stale).toBe(true);
    expect(query.hasNext).toBe(true);

    fake.executions[0]?.complete();
    expect(query.fetching).toBe(false);
    expect(query.isFetching).toBe(false);
    expect(query.stale).toBe(false);
    expect(query.hasNext).toBe(false);
  });

  it('does not track synchronous result-observer dependencies as options', () => {
    const [observerDependency, setObserverDependency] = createSignal(0);
    let executions = 0;
    const client = {
      executeQuery: () => {
        executions += 1;
        return fromValue({
          operation: { kind: 'query', context: {} } as Operation<
            Data,
            Variables
          >,
          data: { value: 'synchronous' },
          stale: false,
          hasNext: false,
        });
      },
    } as unknown as Client;
    const query = setup(() => ({
      ...activeOptions(client),
      onResult: () => observerDependency(),
    }));

    expect(query.data).toEqual({ value: 'synchronous' });
    expect(query.status).toBe('success');
    expect(query.fetchStatus).toBe('idle');
    expect(executions).toBe(1);

    setObserverDependency(1);
    expect(executions).toBe(1);
  });
});

describe('createUrqlQuery refetch', () => {
  it('applies overrides and resolves only after the final fresh result', async () => {
    const fake = makeFakeClient();
    const query = setup(() => ({
      ...activeOptions(fake.client),
      requestPolicy: 'cache-first',
      context: { fetchOptions: { headers: { base: 'yes' } } },
    }));
    fake.executions[0]?.next({ data: { value: 'initial' } });

    let settled = false;
    const refetch = query
      .refetch({
        requestPolicy: 'network-only',
        context: { fetchOptions: { headers: { refresh: 'yes' } } },
      })
      .then((value) => {
        settled = true;
        return value;
      });
    const execution = fake.executions[1];
    expect(execution?.context.requestPolicy).toBe('network-only');
    expect(execution?.context.fetchOptions).toEqual({
      headers: { refresh: 'yes' },
    });

    execution?.next({ data: { value: 'stale' }, stale: true });
    await Promise.resolve();
    expect(settled).toBe(false);

    execution?.next({ data: { value: 'part' }, hasNext: true });
    await Promise.resolve();
    expect(settled).toBe(false);

    execution?.next({ data: { value: 'fresh' }, hasNext: false });
    await expect(refetch).resolves.toBe(query);
    expect(query.data).toEqual({ value: 'fresh' });
  });

  it('retains data for a same-identity refetch when configured to clear new identities', async () => {
    const fake = makeFakeClient();
    const query = setup(() => ({
      ...activeOptions(fake.client),
      keepPreviousData: false,
    }));
    fake.executions[0]?.next({ data: { value: 'existing' } });

    const refetch = query.refetch();
    expect(query.data).toEqual({ value: 'existing' });
    expect(query.isRefetching).toBe(true);

    fake.executions[1]?.next({ data: { value: 'refetched' } });
    await expect(refetch).resolves.toBe(query);
  });

  it('resolves errors by default and rejects with throwOnError', async () => {
    const fake = makeFakeClient();
    const query = setup(() => activeOptions(fake.client));
    const firstError = new CombinedError({ graphQLErrors: ['first'] });
    const secondError = new CombinedError({ graphQLErrors: ['second'] });

    const first = query.refetch();
    fake.executions[1]?.next({ error: firstError });
    await expect(first).resolves.toBe(query);
    expect(query.error).toBe(firstError);

    const second = query.refetch({ throwOnError: true });
    fake.executions[2]?.next({ error: secondError });
    await expect(second).rejects.toBe(secondError);
    expect(query.error).toBe(secondError);
  });

  it('rejects a final stale error when its source completes', async () => {
    const fake = makeFakeClient();
    const query = setup(() => activeOptions(fake.client));
    const error = new CombinedError({ graphQLErrors: ['stale terminal'] });

    const refetch = query.refetch({ throwOnError: true });
    fake.executions[1]?.next({ error, stale: true });
    fake.executions[1]?.complete();

    await expect(refetch).rejects.toBe(error);
    expect(query.fetchStatus).toBe('idle');
    expect(query.stale).toBe(false);
  });

  it('settles before invoking throwing or reentrant result observers', async () => {
    const fake = makeFakeClient();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    let query!: UrqlQueryResult<Data, Variables>;
    let reentrant: Promise<UrqlQueryResult<Data, Variables>> | undefined;
    let shouldReenter = false;
    query = setup(() => ({
      ...activeOptions(fake.client),
      onResult: () => {
        if (shouldReenter) {
          shouldReenter = false;
          reentrant = query.refetch();
          return;
        }
        throw new Error('observer failed');
      },
    }));

    const throwing = query.refetch();
    expect(() =>
      fake.executions[1]?.next({ data: { value: 'first' } })
    ).not.toThrow();
    await expect(throwing).resolves.toBe(query);
    expect(consoleError).toHaveBeenCalledOnce();

    shouldReenter = true;
    const outer = query.refetch();
    fake.executions[2]?.next({ data: { value: 'outer' } });
    await expect(outer).resolves.toBe(query);
    expect(reentrant).toBeDefined();

    let reentrantSettled = false;
    void reentrant?.then(() => {
      reentrantSettled = true;
    });
    await Promise.resolve();
    expect(reentrantSettled).toBe(false);
    fake.executions[3]?.next({ data: { value: 'inner' } });
    await expect(reentrant).resolves.toBe(query);
    consoleError.mockRestore();
  });

  it('settles refetches from synchronously completing sources', async () => {
    const client = {
      executeQuery: () =>
        fromValue({
          operation: { kind: 'query', context: {} } as Operation<
            Data,
            Variables
          >,
          data: { value: 'synchronous' },
          stale: false,
          hasNext: false,
        }),
    } as unknown as Client;
    const query = setup(() => activeOptions(client));

    await expect(query.refetch()).resolves.toBe(query);
    expect(query.data).toEqual({ value: 'synchronous' });
    expect(query.fetchStatus).toBe('idle');
  });

  it('manually executes a disabled query without changing its configured state', async () => {
    const fake = makeFakeClient();
    const query = setup(
      () => ({
        query: DOCUMENT,
        variables: { input: 'manual' },
        enabled: false,
      }),
      fake.client
    );

    expect(fake.executions).toHaveLength(0);
    expect(query.isEnabled).toBe(false);

    const refetch = query.refetch();
    expect(fake.executions).toHaveLength(1);
    expect(query.isEnabled).toBe(false);
    expect(query.isFetching).toBe(true);

    fake.executions[0]?.next({ data: { value: 'manual result' } });
    await expect(refetch).resolves.toBe(query);
    expect(query.data).toEqual({ value: 'manual result' });
    expect(query.isEnabled).toBe(false);
    expect(query.isFetching).toBe(false);
  });

  it('is a safe no-op for a disabled query without variables', async () => {
    const fake = makeFakeClient();
    const query = setup(
      () => ({
        query: DOCUMENT,
        enabled: false,
      }),
      fake.client
    );

    await expect(query.refetch()).resolves.toBe(query);
    expect(fake.executions).toHaveLength(0);
    expect(query.isEnabled).toBe(false);
  });

  it('settles superseded and disposed refetches without leaking promises', async () => {
    const fake = makeFakeClient();
    const query = setup(() => activeOptions(fake.client));

    const superseded = query.refetch();
    const active = query.refetch();
    await expect(superseded).resolves.toBe(query);
    expect(fake.executions[1]?.unsubscribed).toBe(true);

    fake.executions[2]?.next({ data: { value: 'active' } });
    await expect(active).resolves.toBe(query);

    const disposed = query.refetch();
    disposals.pop()?.();
    await expect(disposed).resolves.toBe(query);
    expect(fake.executions[3]?.unsubscribed).toBe(true);
  });
});

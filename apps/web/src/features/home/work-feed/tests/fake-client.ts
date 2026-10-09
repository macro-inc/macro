import type { CacheHost } from '@graphql-cache/host/types';
import {
  type AnyVariables,
  type Client,
  CombinedError,
  type GraphQLRequest,
  type Operation,
  type OperationContext,
  type OperationResult,
} from '@urql/core';
import { makeSubject } from 'wonka';

function operationName(query: unknown): string {
  const doc = query as {
    definitions?: Array<{ kind: string; name?: { value: string } }>;
  };
  const op = doc.definitions?.find((d) => d.kind === 'OperationDefinition');
  return op?.name?.value ?? 'anonymous';
}

export type FakeQuery = {
  variables: Record<string, unknown>;
  context: Partial<OperationContext>;
  resolve(data: unknown): void;
};

export type FakeSubscription = {
  variables: Record<string, unknown>;
  next(data: unknown): void;
  fail(message: string): void;
};

export type FakeMutation = {
  name: string;
  variables: Record<string, unknown>;
};

export type FakeCacheWrite = {
  variables: Record<string, unknown>;
  data: unknown;
};

const variablesKey = (variables: unknown) => JSON.stringify(variables ?? {});

/**
 * A urql client for the work feed: queries stay pending until answered,
 * subscriptions are driven by the test, and mutations answer from
 * `mutationData` keyed by operation name. Its `host` stands in for the
 * normalized cache: reads answer with each page's latest data, and a write
 * re-emits the page to its query the way a cache reread does.
 */
export function createFakeWorkFeedClient(
  mutationData: Record<string, unknown> = {}
) {
  const queries: FakeQuery[] = [];
  const subscriptions: FakeSubscription[] = [];
  const mutations: FakeMutation[] = [];
  const writes: FakeCacheWrite[] = [];
  const cached = new Map<string, unknown>();

  const executeQuery = <D, V extends AnyVariables>(
    request: GraphQLRequest<D, V>,
    context: Partial<OperationContext> = {}
  ) => {
    const subject = makeSubject<OperationResult<D, V>>();
    const operation = { kind: 'query', context } as Operation<D, V>;
    const variables = (request.variables ?? {}) as Record<string, unknown>;
    queries.push({
      variables,
      context,
      resolve: (data) => {
        cached.set(variablesKey(variables), data);
        subject.next({ operation, data } as OperationResult<D, V>);
      },
    });
    return subject.source;
  };

  const subscription = (query: unknown, variables: Record<string, unknown>) => {
    const subject = makeSubject<OperationResult>();
    const operation = { kind: 'subscription' } as Operation;
    subscriptions.push({
      variables,
      next: (data) => subject.next({ operation, data } as OperationResult),
      fail: (message) =>
        subject.next({
          operation,
          error: new CombinedError({ graphQLErrors: [message] }),
        } as OperationResult),
    });
    void query;
    return subject.source;
  };

  const mutation = (query: unknown, variables: Record<string, unknown>) => {
    const name = operationName(query);
    mutations.push({ name, variables });
    return {
      toPromise: async () => ({ data: mutationData[name] }),
    };
  };

  const host = {
    readQuery: async (args: { variables?: Record<string, unknown> }) => {
      const key = variablesKey(args.variables);
      return cached.has(key)
        ? { kind: 'hit' as const, data: cached.get(key) }
        : { kind: 'miss' as const };
    },
    writeQuery: async (args: {
      variables?: Record<string, unknown>;
      data: unknown;
    }) => {
      const variables = args.variables ?? {};
      writes.push({ variables, data: args.data });
      const key = variablesKey(variables);
      queries
        .filter((query) => variablesKey(query.variables) === key)
        .at(-1)
        ?.resolve(args.data);
      return {};
    },
  } as unknown as Pick<CacheHost, 'readQuery' | 'writeQuery'>;

  const client = { executeQuery, subscription, mutation } as unknown as Client;
  return { client, host, queries, subscriptions, mutations, writes };
}

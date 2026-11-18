import { beginQueryAuthorizationReset } from '@app/lib/urql-solid/authorization';
import { QueryObserver } from '@app/lib/urql-solid/query-observer';
import {
  createClient,
  createRequest,
  type Exchange,
  gql,
  makeOperation,
} from '@urql/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filter, fromPromise, map, mergeMap, pipe } from 'wonka';
import { cacheAuthorityExchange } from './authority-exchange';
import { networkRevalidationExchange } from './network-revalidation-exchange';
import {
  optimisticMutationContext,
  optimisticMutationDispositionOf,
  withOptimisticMutationDisposition,
  withoutOptimisticSnapshot,
} from './optimistic';

const query = gql`query Mail { user { emailThread { id name } } }`;
const copied = {
  user: { emailThread: { id: 'thread', name: 'old copied content' } },
};
afterEach(() => beginQueryAuthorizationReset()());

describe('final cache authority admission', () => {
  it('keeps a queued acknowledgement without falling back to a rejected copied snapshot', () => {
    const operation = makeOperation(
      'mutation',
      createRequest(gql`mutation Seen { markEmailThreadSeen { id name } }`, {}),
      {
        url: '/graphql',
        requestPolicy: 'network-only',
        suspense: false,
        ...optimisticMutationContext(copied),
      }
    );
    const result = withOptimisticMutationDisposition(
      {
        operation: withoutOptimisticSnapshot(operation),
        data: copied,
        stale: false,
        hasNext: false,
      },
      { kind: 'queued', transactionId: 'pending-command' }
    );
    expect(result.data).toBeUndefined();
    expect(optimisticMutationDispositionOf(result)).toEqual({
      kind: 'queued',
      transactionId: 'pending-command',
    });
  });
  it('keeps a committed queue disposition but drops its data after delayed revalidation crosses revoke and regrant', async () => {
    const revalidating = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let reads = 0;
    let commits = 0;
    const terminal: Exchange = () => (operations) =>
      pipe(
        operations,
        filter(
          (operation) =>
            operation.kind === 'query' || operation.kind === 'mutation'
        ),
        mergeMap((operation) =>
          fromPromise(
            (async () => {
              if (operation.kind === 'mutation') {
                commits += 1;
                return {
                  operation,
                  data: {
                    setEntityProperty: { id: 'crm-property' },
                    saveEmailDraft: {
                      thread: {
                        __typename: 'GraphqlSoupEmailThread',
                        id: 'canonical',
                        name: 'copied content',
                      },
                    },
                  },
                  stale: false,
                  hasNext: false,
                  extensions: {
                    normalizedCacheMutationDisposition: {
                      kind: 'committed',
                      transactionId: 'saved-once',
                    },
                  },
                };
              }
              if (++reads > 1) {
                revalidating.resolve();
                await release.promise;
              }
              return {
                operation,
                data: { user: { emailThread: null } },
                stale: false,
                hasNext: false,
              };
            })()
          )
        )
      );
    const client = createClient({
      url: '/graphql',
      exchanges: [
        cacheAuthorityExchange,
        networkRevalidationExchange(),
        terminal,
      ],
    });
    const stop = client.query(query, {}).subscribe(() => {});
    try {
      await vi.waitFor(() => expect(reads).toBe(1));
      const pending = client
        .mutation(
          gql`mutation Save {
            saveEmailDraft { thread { ... on GraphqlSoupEmailThread { id name } } }
            setEntityProperty(input: {entityType: CRM_COMPANY}) { id }
          }`,
          {}
        )
        .toPromise();
      await revalidating.promise;
      beginQueryAuthorizationReset()();
      beginQueryAuthorizationReset()();
      release.resolve();
      const result = await pending;
      expect(result.data).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(optimisticMutationDispositionOf(result)).toEqual({
        kind: 'committed',
        data: undefined,
      });
      expect(commits).toBe(1);
    } finally {
      stop.unsubscribe();
    }
  });
  it('rejects a result delayed by an inner exchange until after revocation', async () => {
    const arrived = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const delayed: Exchange = () => (operations) =>
      pipe(
        operations,
        filter((operation) => operation.kind === 'query'),
        mergeMap((operation) =>
          fromPromise(
            (async () => {
              arrived.resolve();
              await release.promise;
              return { operation, data: copied, stale: false, hasNext: false };
            })()
          )
        )
      );
    const client = createClient({
      url: '/graphql',
      exchanges: [cacheAuthorityExchange, delayed],
    });
    const pending = client.query(query, {}).toPromise();
    await arrived.promise;
    beginQueryAuthorizationReset()();
    release.resolve();
    const result = await pending;
    expect(result.data).toBeUndefined();
    expect(result.error?.networkError?.name).toBe('StaleCacheAuthorityError');
  });

  it('refetches a retained same-key urql replay without exposing its old data', async () => {
    let requests = 0;
    const answer: Exchange = () => (operations) =>
      pipe(
        operations,
        filter((operation) => operation.kind === 'query'),
        map((operation) => ({
          operation,
          data: ++requests === 1 ? copied : { user: { emailThread: null } },
          stale: false,
          hasNext: false,
        }))
      );
    const client = createClient({
      url: '/graphql',
      exchanges: [cacheAuthorityExchange, answer],
    });
    const firstValues: unknown[] = [];
    const first = client
      .query(query, {})
      .subscribe((result) => firstValues.push(result.data));
    await vi.waitFor(() => expect(firstValues).toContainEqual(copied));
    const resume = beginQueryAuthorizationReset();
    resume();
    const values: unknown[] = [];
    const second = new QueryObserver(client, { query, variables: {} }, false);
    const stop = second.subscribe((result) => values.push(result.data));
    second.setOptions({ query, variables: {} }, client);
    await vi.waitFor(() =>
      expect(second.getCurrentResult().data).toEqual({
        user: { emailThread: null },
      })
    );
    expect(values).not.toContainEqual(copied);
    expect(requests).toBeGreaterThan(1);
    stop();
    first.unsubscribe();
    second.destroy();
  });
});

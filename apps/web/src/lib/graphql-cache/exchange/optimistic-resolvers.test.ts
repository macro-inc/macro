import { createClient, type Exchange, gql, type Operation } from '@urql/core';
import { describe, expect, it } from 'vitest';
import { fromValue, mergeMap, pipe } from 'wonka';
import { MarkEmailThreadSeenDocument } from '../../service-clients/service-storage/graphql/generated/graphql';
import { executeOptimisticMutation, optimisticContextOf } from './optimistic';
import {
  optimisticResolver,
  optimisticResolversExchange,
} from './optimistic-resolvers';

describe('automatic local mutation resolvers', () => {
  function setup() {
    const forwarded: Operation[] = [];
    const capture: Exchange = () => (source) =>
      pipe(
        source,
        mergeMap((operation) => {
          forwarded.push(operation);
          return fromValue({
            operation,
            data: {},
            stale: false,
            hasNext: false,
          });
        })
      );
    const resolver = optimisticResolver(
      MarkEmailThreadSeenDocument,
      ({ input }) => {
        if (input.threadId === 'invalid')
          throw new Error('Invalid local prediction');
        return {
          response: {
            markEmailThreadSeen: { id: String(input.threadId), isRead: true },
          },
        };
      }
    );
    const client = createClient({
      url: 'http://test.invalid',
      exchanges: [optimisticResolversExchange([resolver]), capture],
    });
    return { client, forwarded, resolver };
  }

  it('supports explicit opt-out and leaves unregistered operations alone', async () => {
    const { client, forwarded } = setup();
    await client
      .mutation(
        MarkEmailThreadSeenDocument,
        { input: { threadId: 'thread' } },
        { optimisticMutation: false }
      )
      .toPromise();
    await client.mutation(gql`mutation Other { other }`, {}).toPromise();
    expect(forwarded.map(optimisticContextOf)).toEqual([undefined, undefined]);
  });

  it('preserves an explicit legacy recipe instead of predicting twice', async () => {
    const { client, forwarded } = setup();
    await executeOptimisticMutation(
      client,
      MarkEmailThreadSeenDocument,
      { input: { threadId: 'thread' } },
      { markEmailThreadSeen: { id: 'thread', isRead: false } },
      { uuid: '00000000-0000-4000-8000-000000000001' }
    ).toPromise();
    expect(optimisticContextOf(forwarded[0])?.optimisticResponse).toEqual({
      markEmailThreadSeen: { id: 'thread', isRead: false },
    });
  });

  it('isolates a broken resolver and sends no network request for it', async () => {
    const { client, forwarded } = setup();
    const result = await client
      .mutation(MarkEmailThreadSeenDocument, { input: { threadId: 'invalid' } })
      .toPromise();
    expect(result.error?.message).toContain('Invalid local prediction');
    expect(forwarded).toHaveLength(0);
    await client
      .mutation(MarkEmailThreadSeenDocument, { input: { threadId: 'valid' } })
      .toPromise();
    expect(forwarded).toHaveLength(1);
  });

  it('rejects ambiguous registration and non-mutation documents', () => {
    const { resolver } = setup();
    expect(() => optimisticResolversExchange([resolver, resolver])).toThrow(
      'Duplicate'
    );
    expect(() =>
      optimisticResolver(gql`query Read { id }`, () => ({ response: {} }))
    ).toThrow('mutation');
  });
});

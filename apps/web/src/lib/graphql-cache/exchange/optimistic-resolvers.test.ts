import { createClient, type Exchange, gql, type Operation } from '@urql/core';
import { describe, expect, it } from 'vitest';
import { fromValue, mergeMap, pipe } from 'wonka';
import { MarkEmailThreadSeenDocument } from '../../service-clients/service-storage/graphql/generated/graphql';
import { executeOptimisticMutation, optimisticContextOf } from './optimistic';
import {
  type OptimisticResolver,
  optimisticResolver,
  optimisticResolversExchange,
} from './optimistic-resolvers';

describe('automatic local mutation resolvers', () => {
  function setup(resolvers?: readonly OptimisticResolver[]) {
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
        return { id: String(input.threadId), isRead: true };
      }
    );
    const client = createClient({
      url: 'http://test.invalid',
      exchanges: [
        optimisticResolversExchange(resolvers ?? [resolver]),
        capture,
      ],
    });
    return { client, forwarded, resolver };
  }

  it('uses the selected response alias without requiring a response envelope', async () => {
    const document = gql<
      { __typename: 'Mutation'; changed: { id: string; isRead: boolean } },
      { id: string }
    >`
      mutation Seen($id: ID!) {
        __typename
        changed: markEmailThreadSeen(input: { threadId: $id }) {
          id
          isRead
        }
      }
    `;
    const resolver = optimisticResolver(document, ({ id }) => ({
      id,
      isRead: true,
    }));
    const { client, forwarded } = setup([resolver]);
    await client.mutation(document, { id: 'thread' }).toPromise();
    expect(optimisticContextOf(forwarded[0])?.optimisticResponse).toEqual({
      changed: { id: 'thread', isRead: true },
    });
  });

  it('combines variable-dependent resolver options with caller options', async () => {
    const lookup = gql`query Thread($id: ID!) { thread(id: $id) { id } }`;
    const resolver = optimisticResolver(
      MarkEmailThreadSeenDocument,
      ({ input }) => ({ id: String(input.threadId), isRead: true }),
      ({ input }) => ({
        revalidations: [
          { document: lookup, variables: { id: input.threadId } },
        ],
      })
    );
    const { client, forwarded } = setup([resolver]);
    await client
      .mutation(
        MarkEmailThreadSeenDocument,
        { input: { threadId: 'thread' } },
        {
          optimisticMutation: {
            revalidations: [{ document: lookup, variables: { id: 'other' } }],
          },
        }
      )
      .toPromise();
    expect(
      optimisticContextOf(forwarded[0])?.revalidations.map(
        (entry) => JSON.parse(entry.variablesJson).id
      )
    ).toEqual(['thread', 'other']);
  });

  it.each([false, null, undefined])(
    'only skips undefined predictions, including for %s',
    async (value) => {
      const document = gql<{
        applied: boolean | null;
      }>`mutation Apply { applied }`;
      const { client, forwarded } = setup([
        optimisticResolver(document, () => value),
      ]);
      await client.mutation(document, {}).toPromise();
      expect(optimisticContextOf(forwarded[0])?.optimisticResponse).toEqual(
        value === undefined ? undefined : { applied: value }
      );
    }
  );

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
      optimisticResolver(gql`query Read { id }`, () => undefined)
    ).toThrow('mutation');
  });

  it.each([
    gql`mutation Both { first { id } second { id } }`,
    gql`mutation Conditional($skip: Boolean!) { first @skip(if: $skip) { id } }`,
    gql`mutation Spread { ...Root } fragment Root on Mutation { first { id } }`,
    gql`mutation Metadata { renamed: __typename }`,
    gql`mutation ExtraMetadata { renamed: __typename first { id } }`,
  ])('rejects roots that cannot be wrapped unambiguously', (document) => {
    expect(() => optimisticResolver(document, () => undefined)).toThrow(
      'one unconditional top-level mutation field'
    );
  });
});

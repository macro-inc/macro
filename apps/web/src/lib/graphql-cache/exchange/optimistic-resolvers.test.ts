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
  function setup(
    resolvers = (seen: OptimisticResolver): readonly OptimisticResolver[] => [
      seen,
    ]
  ) {
    const forwarded: Operation[] = [];
    const resolved: unknown[] = [];
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
    const resolver = optimisticResolver(MarkEmailThreadSeenDocument, (args) => {
      resolved.push(args);
      if (args.input.threadId === 'invalid')
        throw new Error('Invalid local prediction');
      return { id: String(args.input.threadId), isRead: true };
    });
    const client = createClient({
      url: 'http://test.invalid',
      exchanges: [optimisticResolversExchange(resolvers(resolver)), capture],
    });
    return { client, forwarded, resolved, resolver };
  }

  it('predicts the field for another document under its own response key', async () => {
    const { client, forwarded, resolved } = setup();
    await client
      .mutation(
        gql`
          mutation Seen($id: ID!) {
            __typename
            changed: markEmailThreadSeen(input: { threadId: $id }) {
              isRead
            }
          }
        `,
        { id: 'thread' }
      )
      .toPromise();
    expect(resolved).toEqual([{ input: { threadId: 'thread' } }]);
    expect(optimisticContextOf(forwarded[0])?.optimisticResponse).toEqual({
      changed: { id: 'thread', isRead: true },
    });
  });

  it('evaluates literal arguments with variable defaults and omits absent variables', async () => {
    const resolved: unknown[] = [];
    const document = gql<
      { apply: boolean },
      {
        input?: { id?: string; tags?: string[]; mode?: string };
        limit?: number;
      }
    >`mutation Apply($input: ApplyInput, $limit: Int) { apply(input: $input, limit: $limit) }`;
    const { client, forwarded } = setup(() => [
      optimisticResolver(document, (args) => {
        resolved.push(args);
        return true;
      }),
    ]);
    await client
      .mutation(
        gql`
          mutation ApplyFast($id: ID = "default", $tag: String, $limit: Int) {
            apply(input: { id: $id, tags: [$tag, "fixed"], mode: FAST }, limit: $limit)
          }
        `,
        { tag: 'one' }
      )
      .toPromise();
    expect(resolved).toEqual([
      { input: { id: 'default', tags: ['one', 'fixed'], mode: 'FAST' } },
    ]);
    expect(Object.keys(resolved[0] as object)).toEqual(['input']);
    expect(optimisticContextOf(forwarded[0])?.optimisticResponse).toEqual({
      apply: true,
    });
  });

  it('predicts every root field and merges their options', async () => {
    const lookup = gql`query Thread($id: ID!) { thread(id: $id) { id } }`;
    const archive = gql<
      { archived: boolean },
      { threadId: string }
    >`mutation Archive($threadId: ID!) { archived(threadId: $threadId) }`;
    const { client, forwarded } = setup(() => [
      optimisticResolver(
        MarkEmailThreadSeenDocument,
        ({ input }) => ({ id: String(input.threadId), isRead: true }),
        ({ input }) => ({
          revalidations: [
            { document: lookup, variables: { id: input.threadId } },
          ],
        })
      ),
      optimisticResolver(
        archive,
        () => true,
        ({ threadId }) => ({
          revalidations: [{ document: lookup, variables: { id: threadId } }],
        })
      ),
    ]);
    await client
      .mutation(
        gql`
          mutation SeenAndArchived {
            first: markEmailThreadSeen(input: { threadId: "first" }) { id }
            archived(threadId: "second")
            third: markEmailThreadSeen(input: { threadId: "third" }) { id }
          }
        `,
        {},
        {
          optimisticMutation: {
            revalidations: [{ document: lookup, variables: { id: 'caller' } }],
          },
        }
      )
      .toPromise();
    const context = optimisticContextOf(forwarded[0]);
    expect(context?.optimisticResponse).toEqual({
      first: { id: 'first', isRead: true },
      archived: true,
      third: { id: 'third', isRead: true },
    });
    expect(
      context?.revalidations.map((entry) => JSON.parse(entry.variablesJson).id)
    ).toEqual(['first', 'second', 'third', 'caller']);
  });

  it.each([
    [
      'an unregistered field',
      gql`mutation Mixed { markEmailThreadSeen(input: { threadId: "thread" }) { id } other }`,
    ],
    [
      'a conditional field',
      gql`mutation Conditional($skip: Boolean!) { markEmailThreadSeen(input: { threadId: "thread" }) @skip(if: $skip) { id } }`,
    ],
    [
      'a root fragment',
      gql`mutation Spread { ...Root } fragment Root on Mutation { markEmailThreadSeen(input: { threadId: "thread" }) { id } }`,
    ],
  ])('sends %s without any prediction', async (_, document) => {
    const { client, forwarded, resolved } = setup();
    await client.mutation(document, { skip: false }).toPromise();
    expect(forwarded).toHaveLength(1);
    expect(optimisticContextOf(forwarded[0])).toBeUndefined();
    expect(resolved).toEqual([]);
  });

  it('sends no partial prediction when one root field declines', async () => {
    const declined = gql<{
      declined: boolean;
    }>`mutation Declined { declined }`;
    const { client, forwarded, resolved } = setup((seen) => [
      seen,
      optimisticResolver(declined, () => undefined),
    ]);
    await client
      .mutation(
        gql`mutation Both { markEmailThreadSeen(input: { threadId: "thread" }) { id } declined }`,
        {}
      )
      .toPromise();
    expect(resolved).toHaveLength(1);
    expect(forwarded).toHaveLength(1);
    expect(optimisticContextOf(forwarded[0])).toBeUndefined();
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
    const { client, forwarded } = setup(() => [resolver]);
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
      const { client, forwarded } = setup(() => [
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

  it('rejects a second resolver for the same field and non-mutation documents', () => {
    const { resolver } = setup();
    const aliased = optimisticResolver(
      gql<
        { seen: { id: string } },
        { input: { threadId: string } }
      >`mutation Aliased($input: MarkEmailThreadSeenInput!) { seen: markEmailThreadSeen(input: $input) { id } }`,
      ({ input }) => ({ id: input.threadId })
    );
    expect(() => optimisticResolversExchange([resolver, aliased])).toThrow(
      'Duplicate optimistic resolver for mutation field markEmailThreadSeen'
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

  it.each([
    gql`mutation Nested($id: ID!) { first(input: { id: $id }) { id } }`,
    gql`mutation Renamed($other: ID!) { first(id: $other) { id } }`,
    gql`mutation Constant { first(id: "id") { id } }`,
    gql`mutation Unused($id: ID!, $extra: Boolean) { first(id: $id) { id } }`,
  ])(
    'requires representative arguments to be same-named variables',
    (document) => {
      expect(() => optimisticResolver(document, () => undefined)).toThrow(
        'same-named variable'
      );
    }
  );
});

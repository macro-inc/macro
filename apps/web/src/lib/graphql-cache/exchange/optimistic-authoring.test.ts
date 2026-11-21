import {
  executeGraphqlUpdateNotifications,
  executeGraphqlUpdateNotificationsForEntities,
} from '../../service-clients/service-storage/graphql-update-notifications';

vi.mock('../../queries/soup/graphql/channel-list-revalidation', () => ({
  getChannelListRevalidations: () => [],
  revalidateChannelLists: vi.fn(),
}));
vi.mock('../../queries/notification/revalidation', () => ({
  revalidateNotificationReaders: vi.fn(),
}));

import { soupOptimisticResolvers } from '../../queries/optimistic-resolvers';
import { optimisticResolversExchange } from './optimistic-resolvers';

const interfaceExchanges = () => [
  optimisticResolversExchange(soupOptimisticResolvers),
];

import {
  createClient,
  type Exchange,
  makeOperation,
  type Operation,
  stringifyDocument,
} from '@urql/core';
import { describe, expect, it, vi } from 'vitest';
import { fromValue, mergeMap, pipe } from 'wonka';
import {
  EmailThreadPageDocument,
  EntityPropertiesDocument,
} from '../../service-clients/service-storage/graphql/generated/graphql';
import { setGraphqlEmailThreadArchived } from '../../service-clients/service-storage/graphql-email-archive-state';
import {
  markGraphqlEmailThreadSeen,
  markGraphqlEmailThreadUnread,
} from '../../service-clients/service-storage/graphql-email-read-state';
import {
  optimisticContextOf,
  optimisticMutationContext,
  prependUnique,
  select,
  update,
  withoutOptimisticSnapshot,
} from './optimistic';

function setup() {
  const operations: Operation[] = [];
  const network: Exchange = () => (source) =>
    pipe(
      source,
      mergeMap((operation) => {
        operations.push(operation);
        return fromValue({
          operation,
          data: optimisticContextOf(operation)?.optimisticResponse,
          stale: false,
          hasNext: false,
        });
      })
    );
  const client = createClient({
    url: 'http://test.invalid/graphql',
    exchanges: [...interfaceExchanges(), network],
  });
  return { client, operations };
}

describe('optimistic mutation authoring contract', () => {
  it.each([false, true])(
    'materializes query-link repair before stripping snapshots (explicit repair: %s)',
    async (explicit) => {
      const { client, operations } = setup();
      await markGraphqlEmailThreadSeen(client, 'thread');
      const variables = { threadId: 'thread', offset: 0, limit: 20 };
      const patch = update(
        select(EmailThreadPageDocument, variables)
          .field('user')
          .field('emailThread')
          .field('messages'),
        prependUnique({ __typename: 'GraphqlSoupEmailMessage', id: 'draft' })
      );
      const fragmentPatch = {
        ...patch,
        query:
          'fragment ThreadMessages on GraphqlSoupEmailThread { id messages { id } }',
        operationName: undefined,
        variablesJson: '{}',
        recordRoot: {
          entityKey: 'GraphqlSoupEmailThread:thread',
          fragmentName: 'ThreadMessages',
        },
      };
      const operation = makeOperation('mutation', operations[0], {
        ...operations[0].context,
        ...optimisticMutationContext(
          { copied: 'retired response' },
          {
            updates: [patch, patch, fragmentPatch],
            revalidations: explicit
              ? [{ document: EmailThreadPageDocument, variables }]
              : [],
          }
        ),
      });
      const retired = withoutOptimisticSnapshot(operation);
      const expected = [
        {
          query: patch.query,
          operationName: patch.operationName,
          variablesJson: patch.variablesJson,
        },
      ];
      expect(optimisticContextOf(retired)?.revalidations).toEqual(expected);
      expect(optimisticContextOf(retired)?.linkPatches).toEqual([]);
      expect(optimisticContextOf(retired)?.optimisticResponse).toBeUndefined();
      expect(
        optimisticContextOf(withoutOptimisticSnapshot(retired))?.revalidations
      ).toEqual(expected);
      expect(optimisticContextOf(operation)?.linkPatches).toHaveLength(3);
    }
  );

  it('migrates real read/unread callers with field-only payloads and distinct intent IDs', async () => {
    const { client, operations } = setup();
    await markGraphqlEmailThreadSeen(client, 'thread-1');
    await markGraphqlEmailThreadUnread(client, 'thread-1');
    await markGraphqlEmailThreadSeen(client, 'thread-1');
    const contexts = operations.map(optimisticContextOf);
    expect(contexts.map((context) => context?.optimisticResponse)).toEqual([
      {
        markEmailThreadSeen: {
          __typename: 'GraphqlSoupEmailThread',
          id: 'thread-1',
          isRead: true,
        },
      },
      {
        markEmailThreadUnread: {
          __typename: 'GraphqlSoupEmailThread',
          id: 'thread-1',
          isRead: false,
        },
      },
      {
        markEmailThreadSeen: {
          __typename: 'GraphqlSoupEmailThread',
          id: 'thread-1',
          isRead: true,
        },
      },
    ]);
    expect(new Set(contexts.map((context) => context?.uuid)).size).toBe(3);
    expect(contexts.every((context) => context?.linkPatches.length === 0)).toBe(
      true
    );
  });

  it('derives archive and undo from the same variables, without fetching the entity', async () => {
    const { client, operations } = setup();
    await setGraphqlEmailThreadArchived(client, 'thread-1', true);
    await setGraphqlEmailThreadArchived(client, 'thread-1', false);
    expect(
      operations.map(
        (operation) => optimisticContextOf(operation)?.optimisticResponse
      )
    ).toEqual([
      {
        setEmailThreadArchived: {
          __typename: 'GraphqlSoupEmailThread',
          id: 'thread-1',
          inboxVisible: false,
        },
      },
      {
        setEmailThreadArchived: {
          __typename: 'GraphqlSoupEmailThread',
          id: 'thread-1',
          inboxVisible: true,
        },
      },
    ]);
    expect(operations.every((operation) => operation.kind === 'mutation')).toBe(
      true
    );
  });

  it('preserves durable revalidations when the caller has an unpatchable relation', async () => {
    const { client, operations } = setup();
    const revalidation = {
      document: EntityPropertiesDocument,
      variables: {
        input: { entityId: 'thread-2', entityType: 'EMAIL_THREAD' },
      },
    };
    await markGraphqlEmailThreadSeen(client, 'thread-1', [revalidation]);
    expect(optimisticContextOf(operations[0])?.revalidations).toEqual([
      {
        query: stringifyDocument(revalidation.document),
        operationName: 'EntityProperties',
        variablesJson: JSON.stringify(revalidation.variables),
      },
    ]);
    const retired = withoutOptimisticSnapshot(operations[0]);
    expect(optimisticContextOf(retired)?.optimisticResponse).toBeUndefined();
    expect(optimisticContextOf(retired)?.linkPatches).toEqual([]);
    expect(optimisticContextOf(retired)?.revalidations).toEqual(
      optimisticContextOf(operations[0])?.revalidations
    );
  });
});

describe('notification mutation semantics', () => {
  it('patches only state for bulk done; does not guess conditional seen/undone transitions', async () => {
    const { client, operations } = setup();
    for (const operation of [
      'MARK_DONE',
      'MARK_SEEN',
      'MARK_UNDONE',
    ] as const) {
      await executeGraphqlUpdateNotifications(client, {
        notificationIds: ['a', 'b'],
        operation,
      });
    }
    expect(
      operations.map(
        (operation) => optimisticContextOf(operation)?.optimisticResponse
      )
    ).toEqual([
      {
        updateNotifications: ['a', 'b'].map((id) => ({
          __typename: 'GraphqlNotification',
          id,
          state: 'DONE',
        })),
      },
      {
        updateNotifications: ['a', 'b'].map((id) => ({
          __typename: 'GraphqlNotification',
          id,
        })),
      },
      {
        updateNotifications: ['a', 'b'].map((id) => ({
          __typename: 'GraphqlNotification',
          id,
        })),
      },
    ]);
  });

  it('keeps entity-scoped notification writes authoritative for exact undo IDs', async () => {
    const { client, operations } = setup();
    await executeGraphqlUpdateNotificationsForEntities(client, {
      entities: [{ entityId: 'thread', entityType: 'DOCUMENT' }],
      operation: 'MARK_DONE',
    });
    expect(operations).toHaveLength(1);
    expect(optimisticContextOf(operations[0])).toBeUndefined();
  });
});

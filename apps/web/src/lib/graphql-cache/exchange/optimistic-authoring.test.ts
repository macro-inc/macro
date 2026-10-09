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
  type Operation,
  stringifyDocument,
} from '@urql/core';
import { describe, expect, it, vi } from 'vitest';
import { fromValue, mergeMap, pipe } from 'wonka';
import { MarkEmailThreadSeenDocument } from '../../service-clients/service-storage/graphql/generated/graphql';
import { setGraphqlEmailThreadArchived } from '../../service-clients/service-storage/graphql-email-archive-state';
import {
  markGraphqlEmailThreadSeen,
  markGraphqlEmailThreadUnread,
} from '../../service-clients/service-storage/graphql-email-read-state';
import { optimisticContextOf } from './optimistic';

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
      document: MarkEmailThreadSeenDocument,
      variables: { input: { threadId: 'thread-2' } },
    };
    await markGraphqlEmailThreadSeen(client, 'thread-1', [revalidation]);
    expect(optimisticContextOf(operations[0])?.revalidations).toEqual([
      {
        query: stringifyDocument(revalidation.document),
        operationName: 'MarkEmailThreadSeen',
        variablesJson: JSON.stringify(revalidation.variables),
      },
    ]);
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

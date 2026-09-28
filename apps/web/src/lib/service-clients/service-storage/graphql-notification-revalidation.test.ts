import { registerNotificationReader } from '@queries/notification/revalidation';
import { registerGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import { type Client, CombinedError } from '@urql/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelListSoupDocument,
  ChannelUnreadPresenceDocument,
  GroupSoupDocument,
  MailAccountsDocument,
  SoupDocument,
  UpdateNotificationsForEntityDocument,
} from './graphql/generated/graphql';
import { executeGraphqlUpdateNotificationsForEntities } from './graphql-update-notifications';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.restoreAllMocks();
});

function setup() {
  const query = vi.fn(() => ({ toPromise: async () => ({ data: {} }) }));
  const mutation = vi.fn(() => ({
    toPromise: async () => ({ data: { updateNotificationsForEntity: [] } }),
  }));
  const client = { query, mutation } as unknown as Client;
  const initial = { input: { initial: { limit: 20 } } };
  const continuation = { input: { continuation: { cursor: 'loaded-page' } } };
  const pages = [
    { document: SoupDocument, variables: initial },
    { document: SoupDocument, variables: continuation },
    { document: GroupSoupDocument, variables: initial },
    { document: ChannelListSoupDocument, variables: initial },
    { document: ChannelUnreadPresenceDocument, variables: initial },
  ];
  cleanup.push(
    registerGraphqlSoupRevalidations(() => [
      ...pages,
      pages[0],
      { document: MailAccountsDocument, variables: {} },
    ])
  );
  return { client, query, mutation, pages };
}

const input = {
  entities: [{ entityType: 'CHANNEL' as const, entityId: 'channel-1' }],
  operation: 'MARK_SEEN' as const,
};

describe('entity notification reconciliation', () => {
  it.each(['MARK_SEEN', 'MARK_DONE'] as const)(
    'reconciles an empty %s response without changing its undo IDs',
    async (operation) => {
      const { client, query, mutation, pages } = setup();
      const cached = { state: 'UNSEEN' };
      const freshState = operation === 'MARK_SEEN' ? 'SEEN' : 'DONE';
      // Model a normalized notification shared by mounted Soup and feed readers.
      // The server was already fresh, so the mutation contains no patch for it.
      query.mockImplementation(() => ({
        toPromise: async () => {
          cached.state = freshState;
          return { data: {} };
        },
      }));

      const result = await executeGraphqlUpdateNotificationsForEntities(
        client,
        {
          ...input,
          operation,
        }
      );

      expect(cached.state).toBe(freshState);
      expect(result.data?.updateNotificationsForEntity).toEqual([]);
      expect(mutation).toHaveBeenCalledWith(
        UpdateNotificationsForEntityDocument,
        {
          input: { ...input, operation },
        }
      );
      expect(query).toHaveBeenCalledTimes(pages.length);
      for (const { document, variables } of pages) {
        expect(query).toHaveBeenCalledWith(document, variables, {
          requestPolicy: 'network-only',
        });
      }
    }
  );

  it('reconciles omitted stale rows even when some notifications changed', async () => {
    const { client, query } = setup();
    const changed = [
      { __typename: 'GraphqlNotification', id: 'changed', state: 'SEEN' },
    ];
    const response = { data: { updateNotificationsForEntity: changed } };
    const mutation = vi.fn(() => ({ toPromise: async () => response }));
    const mixedClient = { ...client, mutation } as unknown as Client;
    const result = await executeGraphqlUpdateNotificationsForEntities(
      mixedClient,
      input
    );

    expect(query).toHaveBeenCalled();
    expect(result).toBe(response);
    expect(result.data?.updateNotificationsForEntity).toBe(changed);
  });

  it('refreshes only enabled feeds belonging to this client and unregisters disposed feeds', async () => {
    const { client } = setup();
    const active = vi.fn(async () => undefined);
    const disabled = vi.fn(async () => undefined);
    const otherClient = vi.fn(async () => undefined);
    const disposed = vi.fn(async () => undefined);
    for (const [refresh, enabled, owner] of [
      [active, true, client],
      [disabled, false, client],
      [otherClient, true, {} as Client],
    ] as const) {
      cleanup.push(
        registerNotificationReader({
          client: () => owner,
          isEnabled: () => enabled,
          refresh,
        })
      );
    }
    registerNotificationReader({
      client: () => client,
      isEnabled: () => true,
      refresh: disposed,
    })();

    await executeGraphqlUpdateNotificationsForEntities(client, input);

    expect(active).toHaveBeenCalledOnce();
    expect(disabled).not.toHaveBeenCalled();
    expect(otherClient).not.toHaveBeenCalled();
    expect(disposed).not.toHaveBeenCalled();
  });

  it('does not turn a refresh failure into a failed committed mutation', async () => {
    const { client, query, pages } = setup();
    const error = new CombinedError({
      networkError: new Error('offline during refresh'),
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    query.mockReturnValue({ toPromise: async () => ({ data: {}, error }) });
    const feed = vi.fn(async () => {
      throw error;
    });
    cleanup.push(
      registerNotificationReader({
        client: () => client,
        isEnabled: () => true,
        refresh: feed,
      })
    );

    const result = await executeGraphqlUpdateNotificationsForEntities(
      client,
      input
    );

    expect(result.data?.updateNotificationsForEntity).toEqual([]);
    expect(result.error).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(pages.length);
    expect(feed).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      'Failed to reconcile notification state',
      error
    );
  });

  it.each([
    {
      error: new CombinedError({ networkError: new Error('mutation failed') }),
    },
    {},
  ])('does not revalidate an unsuccessful mutation', async (response) => {
    const { client, query } = setup();
    const mutation = vi.fn(() => ({ toPromise: async () => response }));
    await executeGraphqlUpdateNotificationsForEntities(
      { ...client, mutation } as unknown as Client,
      input
    );
    expect(query).not.toHaveBeenCalled();
  });
});

import type { CacheHost } from '@graphql-cache/host/types';
import { parseCacheRevision } from '@graphql-cache/protocol';
import {
  ChannelListSoupDocument,
  ChannelUnreadCacheWriteDocument,
  ChannelUnreadPresenceDocument,
  type ChannelUnreadPresenceQueryVariables,
  type SoupNotificationFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import { type DocumentNode, print, visit } from 'graphql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerGraphqlSoupRevalidations } from '../soup/graphql/active-queries';
import { cacheNewChannelUnread } from './unread-cache';

const notification: SoupNotificationFieldsFragment = {
  id: 'notification',
  entityType: 'CHANNEL',
  entityId: 'channel',
  eventType: 'channel_message_send',
  state: 'UNSEEN',
  sent: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  viewedAt: null,
  senderId: 'sender',
  metadata: {
    __typename: 'GraphqlChannelMessageSendMetadata',
    channelMessageSendSender: 'sender',
    channelMessageSendMessageId: 'message',
    channelMessageSendChannelType: 'PRIVATE',
    channelMessageSendMessageContent: 'Hello',
    channelMessageSendHasAttachments: false,
    channelMessageSendSenderDisplayName: null,
    channelMessageSendChannelName: 'Channel',
    channelMessageSendSenderProfilePictureUrl: null,
  },
};
const variables: ChannelUnreadPresenceQueryVariables = {
  input: {
    initial: {
      limit: 2,
      filters: { channelFilter: { literal: { notificationState: 'UNSEEN' } } },
    },
  },
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function setup(ids = ['other']) {
  cleanups.push(
    registerGraphqlSoupRevalidations(() => [
      { document: ChannelUnreadPresenceDocument, variables },
    ])
  );
  const host = {
    readQuery: vi.fn<CacheHost['readQuery']>().mockResolvedValue({
      kind: 'hit',
      data: {
        user: {
          id: 'viewer',
          soup: {
            items: ids.map((id) => ({ __typename: 'GraphqlSoupChannel', id })),
          },
        },
      },
    }),
    writeQuery: vi.fn<CacheHost['writeQuery']>().mockResolvedValue({
      affectedOps: [],
      revision: parseCacheRevision('1'),
      revisionAdvanced: true,
      changed: [],
      reset: false,
    }),
  };
  return host;
}

describe('websocket channel unread cache writes', () => {
  it.each([
    'channel_message_send',
    'channel_message_reply',
    'channel_mention',
    'document_mention',
  ])(
    'links %s and admits its channel to an empty badge page',
    async (eventType) => {
      const host = setup([]);
      expect(
        await cacheNewChannelUnread(
          host,
          { ...notification, eventType },
          () => true
        )
      ).toBe(true);
      expect(host.writeQuery).toHaveBeenCalledTimes(2);
      expect(host.writeQuery.mock.calls[0][0]).toMatchObject({
        operationName: 'ChannelUnreadCacheWrite',
        data: {
          soupUpdates: [
            {
              __typename: 'SoupUpdated',
              item: {
                __typename: 'GraphqlSoupChannel',
                id: 'channel',
                unreadNotifications: [
                  {
                    id: 'notification',
                    state: 'UNSEEN',
                    createdAt: notification.createdAt,
                  },
                ],
              },
            },
          ],
        },
      });
      expect(host.writeQuery.mock.calls[1][0].data).toEqual({
        user: {
          id: 'viewer',
          soup: {
            items: [{ __typename: 'GraphqlSoupChannel', id: 'channel' }],
          },
        },
      });
    }
  );

  it('preserves other badge identities without replaying their notification states, and stays bounded', async () => {
    const host = setup(['other', 'oldest']);
    await cacheNewChannelUnread(host, notification, () => true);
    expect(host.writeQuery.mock.calls[1][0].data).toEqual({
      user: {
        id: 'viewer',
        soup: {
          items: [
            { __typename: 'GraphqlSoupChannel', id: 'channel' },
            { __typename: 'GraphqlSoupChannel', id: 'other' },
          ],
        },
      },
    });
  });

  it('does not duplicate an existing badge channel or rewrite its membership', async () => {
    const host = setup(['channel']);
    await cacheNewChannelUnread(host, notification, () => true);
    expect(host.writeQuery).toHaveBeenCalledOnce();
  });

  it.each([
    { state: 'SEEN' as const },
    { state: 'DONE' as const },
    { eventType: 'call_started' },
    { eventType: 'channel_invite' },
    { entityType: 'DOCUMENT' as const },
  ])('does not admit non-message or read evidence: %j', async (patch) => {
    const host = setup();
    expect(
      await cacheNewChannelUnread(
        host,
        { ...notification, ...patch },
        () => true
      )
    ).toBe(false);
    expect(host.writeQuery).not.toHaveBeenCalled();
    expect(host.readQuery).not.toHaveBeenCalled();
  });

  it('falls back for a cold badge without inventing its user identity or losing the local channel write', async () => {
    const host = setup();
    host.readQuery.mockResolvedValue({ kind: 'miss' });
    expect(await cacheNewChannelUnread(host, notification, () => true)).toBe(
      false
    );
    expect(host.writeQuery).toHaveBeenCalledOnce();
  });

  it('does not write membership after disposal or cache replacement during a read', async () => {
    const host = setup();
    let current = true;
    host.readQuery.mockImplementation(async () => {
      current = false;
      return {
        kind: 'hit',
        data: { user: { id: 'old-viewer', soup: { items: [] } } },
      };
    });
    expect(await cacheNewChannelUnread(host, notification, () => current)).toBe(
      false
    );
    expect(host.writeQuery).toHaveBeenCalledOnce();
  });

  it('uses exactly the same argument-keyed relationship as the channel list and badge', () => {
    const argumentsOf = (document: DocumentNode) => {
      let argumentsKey: string | undefined;
      visit(document, {
        Field(node) {
          if (node.alias?.value === 'unreadNotifications') {
            argumentsKey = node.arguments
              ?.map((argument) => print(argument))
              .join('\n');
          }
        },
      });
      return argumentsKey;
    };
    const key = argumentsOf(ChannelUnreadCacheWriteDocument);
    expect(key).toBeDefined();
    expect(argumentsOf(ChannelListSoupDocument)).toBe(key);
    expect(argumentsOf(ChannelUnreadPresenceDocument)).toBe(key);
  });
});

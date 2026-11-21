import type { UnifiedNotification } from '@notifications/types';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import {
  bumpSoupEntityNotifiedAt,
  hasSoupEntity,
  optimisticUpdateSoupItemUpdatedAt,
  refetchSoupEntity,
  restoreSoupEntityToDoneFilteredQueries,
} from '@queries/soup/normalized-cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateSoupForNotification } from '../notification-soup';

vi.mock('@queries/soup/normalized-cache', () => ({
  bumpSoupEntityNotifiedAt: vi.fn(),
  optimisticUpdateSoupItemUpdatedAt: vi.fn(),
  hasSoupEntity: vi.fn(() => false),
  refetchSoupEntity: vi.fn(),
  restoreSoupEntityToDoneFilteredQueries: vi.fn(),
}));

vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: vi.fn(async () => {}),
}));

const mockRefreshGraphqlLists = vi.mocked(refreshActiveGraphqlSoupQueries);
const mockBumpNotifiedAt = vi.mocked(bumpSoupEntityNotifiedAt);
const mockHasSoupEntity = vi.mocked(hasSoupEntity);
const mockUpdateUpdatedAt = vi.mocked(optimisticUpdateSoupItemUpdatedAt);
const mockRefetchSoupEntity = vi.mocked(refetchSoupEntity);
const mockRestoreToDoneFiltered = vi.mocked(
  restoreSoupEntityToDoneFilteredQueries
);

function createMockNotification(
  overrides: Partial<UnifiedNotification> = {}
): UnifiedNotification {
  return {
    id: `notification-${Math.random().toString(36).slice(2)}`,
    entity_id: 'entity-1',
    entity_type: 'document',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    viewed_at: null,
    deleted_at: null,
    state: 'unseen',
    sent: true,
    notification_event_type: 'item_shared_user',
    notification_metadata: {
      tag: 'item_shared_user',
      content: {
        sharedBy: 'user-1',
        permissionLevel: 'editor',
      },
    },
    ...overrides,
  } as UnifiedNotification;
}

describe('updateSoupForNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasSoupEntity.mockReset().mockReturnValue(false);
  });

  it('moves a cached row up and restores it into done-filtered feeds', () => {
    mockHasSoupEntity.mockReturnValue(true);
    const notification = createMockNotification({ id: 'new-notification' });

    updateSoupForNotification(notification);

    expect(mockUpdateUpdatedAt).toHaveBeenCalledWith(
      notification.entity_id,
      'document',
      notification.created_at
    );
    // The inbox's notified_at order moves the row up on arrival.
    expect(mockBumpNotifiedAt).toHaveBeenCalledWith(
      notification.entity_id,
      notification.created_at
    );
    // A row marked done was removed from the done-filtered feeds; re-add it.
    expect(mockRestoreToDoneFiltered).toHaveBeenCalledWith(
      notification.entity_id,
      'unseen'
    );
    expect(mockRefetchSoupEntity).not.toHaveBeenCalled();
  });

  it('stamps the thread row for a thread-scoped channel notification', () => {
    // The channel row is cached, the thread row is not.
    mockHasSoupEntity.mockImplementation((id) => id === 'channel-1');

    const mention = createMockNotification({
      entity_type: 'channel',
      entity_id: 'channel-1',
      created_at: '2024-01-01T00:00:00.000Z',
      notification_event_type: 'channel_mention',
      notification_metadata: {
        tag: 'channel_mention',
        content: {
          messageContent: 'hey @you',
          messageId: 'msg-1',
          threadId: 'thread-1',
        },
      },
    } as unknown as Partial<UnifiedNotification>);

    updateSoupForNotification(mention);

    // The channel row still tracks recency, but the notification belongs to
    // the thread row, which is what the inbox's notified_at order keys on.
    expect(mockUpdateUpdatedAt).toHaveBeenCalledWith(
      'channel-1',
      'channel',
      '2024-01-01T00:00:00.000Z'
    );
    expect(mockBumpNotifiedAt).toHaveBeenCalledWith(
      'thread-1',
      '2024-01-01T00:00:00.000Z'
    );
    expect(mockBumpNotifiedAt).not.toHaveBeenCalledWith(
      'channel-1',
      expect.anything()
    );
    expect(mockRefetchSoupEntity).toHaveBeenCalledWith(
      'thread-1',
      'channelThread',
      { notified: true }
    );
    expect(mockRefetchSoupEntity).not.toHaveBeenCalledWith(
      'channel-1',
      expect.anything()
    );
    // The feed row for a thread-scoped notification is the thread, so that is
    // the row restored into the done-filtered feeds.
    expect(mockRestoreToDoneFiltered).toHaveBeenCalledWith(
      'thread-1',
      'unseen'
    );
    expect(mockRestoreToDoneFiltered).not.toHaveBeenCalledWith('channel-1');
  });

  it.each([undefined, 'thread-1'])(
    'restores the correct inbox row for a reaction (threadId: %s)',
    (threadId) => {
      mockHasSoupEntity.mockImplementation((id) => id === 'channel-1');
      const reaction = createMockNotification({
        entity_type: 'channel',
        entity_id: 'channel-1',
        notification_event_type: 'channel_message_reaction',
        notification_metadata: {
          tag: 'channel_message_reaction',
          content: {
            messageId: 'message-1',
            threadId,
            messageContent: 'A message',
            emoji: '👍',
            channelType: 'public',
          },
        },
      });

      updateSoupForNotification(reaction);

      const rootId = threadId ?? 'message-1';
      expect(mockBumpNotifiedAt).toHaveBeenCalledExactlyOnceWith(
        rootId,
        reaction.created_at
      );
      expect(mockRefetchSoupEntity).toHaveBeenCalledExactlyOnceWith(
        rootId,
        'channelThread',
        { notified: true }
      );
      expect(mockRestoreToDoneFiltered).toHaveBeenCalledExactlyOnceWith(
        rootId,
        'unseen'
      );
    }
  );

  it('bumps the updatedAt of an already-cached email thread', () => {
    mockHasSoupEntity.mockReturnValue(true);

    updateSoupForNotification(
      createMockNotification({
        entity_type: 'email_thread',
        entity_id: 'thread-1',
        created_at: '2024-01-01T00:00:00.000Z',
      })
    );

    expect(mockUpdateUpdatedAt).toHaveBeenCalledWith(
      'thread-1',
      'emailThread',
      '2024-01-01T00:00:00.000Z'
    );
    expect(mockRefetchSoupEntity).not.toHaveBeenCalled();
  });

  it('refetches a brand-new soup entity that is not cached', () => {
    mockHasSoupEntity.mockReturnValue(false);

    updateSoupForNotification(
      createMockNotification({
        entity_type: 'email_thread',
        entity_id: 'thread-1',
        created_at: '2024-01-01T00:00:00.000Z',
      })
    );

    expect(mockRefetchSoupEntity).toHaveBeenCalledWith(
      'thread-1',
      'emailThread',
      { notified: true }
    );
    expect(mockUpdateUpdatedAt).not.toHaveBeenCalled();
  });

  it('skips the timestamp bump when a cached entity has no created_at', () => {
    mockHasSoupEntity.mockReturnValue(true);

    updateSoupForNotification(
      createMockNotification({ created_at: undefined })
    );

    expect(mockUpdateUpdatedAt).not.toHaveBeenCalled();
    expect(mockRefetchSoupEntity).not.toHaveBeenCalled();
  });

  it('restores an agent-session row on an agent notification', () => {
    // An agent-session row marked done left the inbox; the next settled /
    // waiting-for-input notification has to bring it back like any other
    // notification-backed entity.
    mockHasSoupEntity.mockReturnValue(true);

    updateSoupForNotification(
      createMockNotification({
        entity_type: 'agent_session',
        entity_id: 'session-1',
        created_at: '2024-01-01T00:00:00.000Z',
        notification_event_type: 'agent_session_settled',
        notification_metadata: {
          tag: 'agent_session_settled',
          content: {
            sessionName: 'Fix mark done',
            excerpt: 'Done.',
          },
        },
      } as unknown as Partial<UnifiedNotification>)
    );

    expect(mockUpdateUpdatedAt).toHaveBeenCalledWith(
      'session-1',
      'agentSession',
      '2024-01-01T00:00:00.000Z'
    );
    expect(mockBumpNotifiedAt).toHaveBeenCalledWith(
      'session-1',
      '2024-01-01T00:00:00.000Z'
    );
    expect(mockRestoreToDoneFiltered).toHaveBeenCalledWith(
      'session-1',
      'unseen'
    );
  });

  it.each(['user', 'database'] as const)(
    'skips the Soup update for %s entities',
    (entityType) => {
      updateSoupForNotification(
        createMockNotification({
          entity_type: entityType,
          created_at: '2024-01-01T00:00:00.000Z',
        })
      );

      expect(mockUpdateUpdatedAt).not.toHaveBeenCalled();
      expect(mockRefetchSoupEntity).not.toHaveBeenCalled();
    }
  );
});

describe('GraphQL notified list re-reads', () => {
  const setVisibility = (value: DocumentVisibilityState) =>
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value);

  beforeEach(async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'],
    });
    setVisibility('visible');
    // Showing the tab resets the module re-reader's spacing; then let the
    // previous test's replica-lag read run out.
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10_000);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('re-reads notified lists, grouped ones too, then again after replica lag', async () => {
    updateSoupForNotification(createMockNotification());
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRefreshGraphqlLists).toHaveBeenCalledTimes(1);
    const where = mockRefreshGraphqlLists.mock.calls[0]?.[0]?.where;
    expect(where?.({ params: { sort_method: 'notified_at' } })).toBe(true);
    // A notification changes which rows a grouped notified list holds
    // (Signal, unseen filters) though not its update-time order.
    expect(
      where?.({
        params: { sort_method: 'notified_at' },
        groupBy: { type: 'entity_type' },
      })
    ).toBe(true);
    expect(where?.({ params: { sort_method: 'updated_at' } })).toBe(false);
    expect(where?.(undefined)).toBe(false);

    await vi.advanceTimersByTimeAsync(3000);
    expect(mockRefreshGraphqlLists).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockRefreshGraphqlLists).toHaveBeenCalledTimes(2);
  });

  it('spaces the re-reads of a burst', async () => {
    for (const entityId of ['a', 'b', 'c', 'd', 'e'])
      updateSoupForNotification(
        createMockNotification({ entity_id: entityId })
      );
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRefreshGraphqlLists).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    // The burst's follow-up, then the replica-lag read.
    expect(mockRefreshGraphqlLists).toHaveBeenCalledTimes(3);
  });

  it('re-reads for kinds the REST normalizer does not track', async () => {
    updateSoupForNotification(
      createMockNotification({ entity_type: 'initiative' })
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRefreshGraphqlLists).toHaveBeenCalledTimes(1);
    expect(mockRefetchSoupEntity).not.toHaveBeenCalled();
  });

  it('waits for a hidden tab to be shown', async () => {
    setVisibility('hidden');
    updateSoupForNotification(createMockNotification());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockRefreshGraphqlLists).not.toHaveBeenCalled();

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRefreshGraphqlLists).toHaveBeenCalledTimes(1);
  });
});

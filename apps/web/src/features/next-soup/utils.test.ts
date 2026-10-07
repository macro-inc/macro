import { createCalendarRange } from '@app/features/calendar-view/calendar-range';
import {
  previewBlockTarget,
  previewCalendarTarget,
} from '@components/app/previewTarget';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  homeCalendarNavigation,
  homePreviewNavigation,
} from '../home/home-preview-navigation';
import { homePreviewTarget } from '../home/home-route';

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: vi.fn(() => false),
}));

const toastAlert = vi.hoisted(() => vi.fn());
const toastFailure = vi.hoisted(() => vi.fn());
const fetchChannelNotifications = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/graphql-notifications', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@service-storage/graphql-notifications')
  >()),
  fetchGraphqlEntityNotifications: fetchChannelNotifications,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { alert: toastAlert, failure: toastFailure },
}));

const operationMocks = vi.hoisted(() => {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
    },
  });
  return {
    graphql: false,
    archive: vi.fn(async (): Promise<'committed' | 'queued'> => 'committed'),
    doneOverride: vi.fn((_ids: readonly string[], _done: boolean | undefined) =>
      Object.assign(vi.fn(), { release: vi.fn() })
    ),
    bulkMarkNotificationsAsDone: vi.fn(async () => {}),
    bulkMarkNotificationsAsUndone: vi.fn(async () => {}),
    cancelQueries: vi.fn(async () => {}),
    flagArchived: vi.fn(async () => ({
      isErr: () => false,
      value: undefined,
    })),
    invalidateQueries: vi.fn(
      async (_options: { queryKey?: readonly unknown[] }) => {}
    ),
    invalidateSoupEntity: vi.fn(async () => {}),
    openExternalUrl: vi.fn(),
    updateNotificationsForEntities: vi.fn(
      async (): Promise<Array<{ id: string }>> => []
    ),
  };
});

// utils.ts transitively imports the websocket client modules, which open real
// sockets at module scope and reject under jsdom.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@notifications')>()),
  setDoneOverride: operationMocks.doneOverride,
}));
vi.mock('@queries/email/integration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/email/integration')>()),
  archiveEmailThread: operationMocks.archive,
}));
vi.mock('@core/util/url', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/url')>()),
  openExternalUrl: operationMocks.openExternalUrl,
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    cancelQueries: operationMocks.cancelQueries,
    invalidateQueries: operationMocks.invalidateQueries,
    getQueriesData: vi.fn(() => []),
  },
}));
vi.mock('@queries/notification/entity-mutations', () => ({
  toNotificationEntityRef: vi.fn(),
  updateNotificationsForEntities: operationMocks.updateNotificationsForEntities,
}));
vi.mock('@queries/notification/user-notifications', () => ({
  bulkMarkNotificationsAsDone: operationMocks.bulkMarkNotificationsAsDone,
  bulkMarkNotificationsAsUndone: operationMocks.bulkMarkNotificationsAsUndone,
  restoreUserNotifications: vi.fn(),
  snapshotUserNotifications: vi.fn(() => []),
}));
vi.mock('@queries/soup/cache', () => ({
  getSoupEntityById: vi.fn(),
  invalidateSoupEntity: operationMocks.invalidateSoupEntity,
  optimisticUpdateSoupEntity: vi.fn(() => ({ rollback: vi.fn() })),
  removeSoupEntities: vi.fn(() => ({ rollback: vi.fn() })),
  removeSoupEntitiesFromDoneFilteredQueries: vi.fn(() => ({
    rollback: vi.fn(),
  })),
}));
const hideGraphqlSoupEntitiesAsDone = vi.hoisted(() =>
  vi.fn(() => ({ release: vi.fn(), setDone: vi.fn(), settle: vi.fn() }))
);
vi.mock('@queries/soup/graphql/optimistic-done', () => ({
  hideGraphqlSoupEntitiesAsDone,
}));
vi.mock('@service-email/client', () => ({
  emailClient: { flagArchived: operationMocks.flagArchived },
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@core/constant/featureFlags')>();
  return {
    ...actual,
    enableCalendarUi: { key: 'enable-calendar-ui' },
    enableReminders: { key: 'enable-reminders' },
    isFeatureEnabled: (flag: Parameters<typeof actual.isFeatureEnabled>[0]) => {
      if ('key' in flag && flag.key === 'enable-graphql-soup')
        return operationMocks.graphql;
      return 'key' in flag &&
        (flag.key === 'enable-calendar-ui' || flag.key === 'enable-reminders')
        ? true
        : actual.isFeatureEnabled(flag);
    },
  };
});

import type { SerializedSearchParams } from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
import type {
  OpenWithSplitOptions,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import {
  type ChannelEntity,
  type ChannelEntityTarget,
  type EntityData,
  queryKeys,
} from '@entity';
import type { NotificationSource, UnifiedNotification } from '@notifications';
import { hydrateChannelNotificationSelection } from '@queries/channel/notification-selection';
import {
  applyEntitiesDoneOptimistic,
  applyEntitiesNotDoneOptimistic,
  type CalendarPreviewSelection,
  type ChannelPreviewSelection,
  channelIdForPreviewNavigation,
  channelPreviewSelection,
  executeMarkEntitiesDone,
  executeMarkEntitiesUndone,
  getChannelEntityTarget,
  getDocumentCommentTarget,
  getRowClickFallbackLocation,
  markChannelNotificationsSeenOnOpen,
  openEntityInSplitFromUnifiedList,
  resolveMarkEntitiesDoneVariables,
} from './utils';

function targetSearch(
  open: ReturnType<typeof vi.fn>,
  namespace: string,
  current?: SerializedSearchParams
) {
  const options = open.mock.calls.at(-1)?.[1] as OpenWithSplitOptions;
  const update = options.search?.[namespace];
  return typeof update === 'function' ? update(current) : update;
}

afterEach(() => {
  operationMocks.graphql = false;
  setGlobalSplitManager(undefined);
  vi.clearAllMocks();
  vi.mocked(isTouchDevice).mockReturnValue(false);
});

describe('agent session search navigation', () => {
  const entity = {
    type: 'agent_session' as const,
    id: 'session',
    name: 'Investigation',
    ownerId: 'owner',
    botId: 'bot',
    status: 'event',
    search: {
      nameHighlight: null,
      senderHighlightTerms: null,
      source: 'service' as const,
      contentHitData: [
        {
          type: 'agent' as const,
          content: 'match',
          location: {
            type: 'agent' as const,
            messageTurn: 0,
            author: 'user' as const,
          },
        },
      ],
    },
  };
  it('uses the first folded hit for row clicks, but not title-only hits', () => {
    expect(getRowClickFallbackLocation(entity)).toEqual({
      type: 'agent',
      messageTurn: 0,
      author: 'user',
    });
    const titleOnly = {
      ...entity,
      search: { ...entity.search, contentHitData: null },
    };
    expect(getRowClickFallbackLocation(titleOnly)).toBeUndefined();
  });
  it.each([
    { status: 'opened', notify: false },
    { status: 'unavailable', notify: false },
    { status: 'reused', owner: 'existing', sourceOwner: 'list', notify: true },
    {
      status: 'reused',
      owner: 'existing',
      sourceOwner: 'existing',
      notify: false,
    },
  ])(
    'owns the toast policy for $status from $sourceOwner',
    async ({ notify, ...result }) => {
      const openWithSplit = vi.fn(() => result);
      setGlobalSplitManager({
        activeSplit: () => undefined,
        getOrchestrator: () => ({
          getBlockHandle: vi.fn(async () => undefined),
        }),
        openWithSplit,
      } as unknown as SplitManager);
      await openEntityInSplitFromUnifiedList(entity, {});
      expect(openWithSplit).toHaveBeenCalledOnce();
      if (notify)
        expect(toastAlert).toHaveBeenCalledExactlyOnceWith(
          'Content already open'
        );
      else expect(toastAlert).not.toHaveBeenCalled();
    }
  );

  it('carries agent targets through route search without waiting for block handles', async () => {
    const openWithSplit = vi.fn(() => ({ status: 'unavailable' }));
    const goToLocationFromParams = vi.fn();
    const getBlockHandle = vi.fn(async () => ({ goToLocationFromParams }));
    setGlobalSplitManager({
      activeSplit: () => undefined,
      getOrchestrator: () => ({ getBlockHandle }),
      getSplitByContent: vi.fn(),
      findOpenView: vi.fn(),
      openWithSplit,
    } as unknown as SplitManager);
    await openEntityInSplitFromUnifiedList(entity, {});
    expect(openWithSplit).toHaveBeenCalledWith(
      {
        type: 'agent',
        id: 'session',
        params: undefined,
      },
      expect.any(Object)
    );
    await openEntityInSplitFromUnifiedList(entity, {
      location: { type: 'agent', messageTurn: 4, author: 'agent' },
    });
    expect(targetSearch(openWithSplit, 'agent-detail')).toMatchObject({
      messageTurn: ['4'],
      author: ['agent'],
      seek: [expect.any(String)],
    });
    expect(getBlockHandle).not.toHaveBeenCalled();
    expect(goToLocationFromParams).not.toHaveBeenCalled();
  });
});

const sendNotification = (id: string, messageId: string): UnifiedNotification =>
  ({
    id,
    entity_type: 'channel',
    entity_id: 'channel-1',
    state: 'unseen',
    notification_event_type: 'channel_message_send',
    notification_metadata: {
      tag: 'channel_message_send',
      content: { messageId },
    },
  }) as unknown as UnifiedNotification;

const replyNotification = (
  id: string,
  messageId: string,
  threadId: string
): UnifiedNotification =>
  ({
    id,
    entity_type: 'channel',
    entity_id: 'channel-1',
    state: 'unseen',
    notification_event_type: 'channel_message_reply',
    notification_metadata: {
      tag: 'channel_message_reply',
      content: { messageId, threadId },
    },
  }) as unknown as UnifiedNotification;

const asRead = (notification: UnifiedNotification): UnifiedNotification =>
  ({
    ...notification,
    state: 'seen',
    viewed_at: '2026-07-14T00:00:00.000Z',
  }) as unknown as UnifiedNotification;

const notificationSourceWithBulkMarkAsRead = (
  bulkMarkAsRead: NotificationSource['bulkMarkAsRead'] = vi.fn(async () => {})
) => ({ bulkMarkAsRead }) as unknown as NotificationSource;

const channelMessageRow = (opts?: {
  target?: ChannelEntityTarget;
  notifications?: UnifiedNotification[];
}): EntityData =>
  ({
    type: 'channel_message',
    id: 'channel-1:hit-msg',
    channelId: 'channel-1',
    messageId: 'hit-msg',
    threadId: 'hit-thread',
    ...(opts?.target ? { target: opts.target } : {}),
    ...(opts?.notifications ? { notifications: () => opts.notifications } : {}),
  }) as unknown as EntityData;

const channelRow = (opts?: {
  target?: ChannelEntityTarget;
  notifications?: UnifiedNotification[];
}): EntityData =>
  ({
    type: 'channel',
    id: 'channel-1',
    ...(opts?.target ? { target: opts.target } : {}),
    ...(opts?.notifications ? { notifications: () => opts.notifications } : {}),
  }) as unknown as EntityData;

const channelThreadRow = (opts?: {
  target?: ChannelEntityTarget;
  notifications?: UnifiedNotification[];
}): EntityData =>
  ({
    type: 'channel_thread',
    id: 'root-msg',
    channelId: 'channel-1',
    messageId: 'root-msg',
    threadId: 'root-msg',
    ...(opts?.target ? { target: opts.target } : {}),
    ...(opts?.notifications ? { notifications: () => opts.notifications } : {}),
  }) as unknown as EntityData;

describe('non-blocking latest channel opens', () => {
  function setup(status = 'opened') {
    const channel: ChannelEntity = {
      type: 'channel',
      id: 'channel-1',
      name: 'Channel',
      ownerId: 'owner',
      channelType: 'private',
      isParticipant: true,
      unreadNotifications: [],
    };
    const bulkMarkAsRead = vi.fn(async () => {});
    const notificationsByEntity = vi.fn(() => ({
      'channel@channel-1': [sendNotification('stale-global', 'message')],
    }));
    const source = {
      ...notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
      notificationsByEntity,
      withLocalOverrides: (notification: UnifiedNotification) => notification,
    };
    const isActive = vi.fn(() => true);
    const findOpenView = vi.fn(() => ({
      owner: 'channel-pane',
      topLevelSplit: { isActive },
    }));
    const openWithSplit = vi.fn(
      (_content: unknown, _options?: OpenWithSplitOptions) => ({ status })
    );
    setGlobalSplitManager({
      activeSplit: vi.fn(),
      getOrchestrator: () => ({
        getBlockHandle: vi.fn(async () => undefined),
      }),
      findOpenView,
      openWithSplit,
    } as unknown as SplitManager);
    const open = () =>
      openEntityInSplitFromUnifiedList(channel, {
        referredFrom: 'channels',
        channelNavigation: 'latest',
        channelReadScope: 'top-level',
        notificationSource: source,
      });
    return {
      channel,
      source,
      open,
      openWithSplit,
      bulkMarkAsRead,
      notificationsByEntity,
      findOpenView,
      isActive,
    };
  }

  it('opens before hydration settles, then marks only full-edge top-level unreads', async () => {
    const test = setup();
    let resolve!: (notifications: UnifiedNotification[]) => void;
    fetchChannelNotifications.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const opening = test.open();
    expect(test.openWithSplit).toHaveBeenCalledOnce();
    expect(test.bulkMarkAsRead).not.toHaveBeenCalled();
    // Opening itself completes while the notification request is still pending.
    await opening;
    expect(test.bulkMarkAsRead).not.toHaveBeenCalled();
    const root = sendNotification('root', 'message');
    resolve([
      root,
      asRead(sendNotification('seen', 'seen-message')),
      replyNotification('reply', 'reply-message', 'message'),
    ]);
    await vi.waitFor(() =>
      expect(test.bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([root])
    );
    expect(test.notificationsByEntity).not.toHaveBeenCalled();
    expect(test.openWithSplit).toHaveBeenCalledOnce();
    expect(toastFailure).not.toHaveBeenCalled();
  });

  it('keeps the channel open and leaves unread state untouched when hydration fails', async () => {
    const test = setup();
    const error = new Error('Conversation notifications are unavailable');
    fetchChannelNotifications.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await test.open();
      await vi.waitFor(() =>
        expect(log).toHaveBeenCalledWith(
          'Failed to load conversation notifications after opening',
          { channelId: 'channel-1', error }
        )
      );
      expect(test.openWithSplit).toHaveBeenCalledOnce();
      expect(test.bulkMarkAsRead).not.toHaveBeenCalled();
      expect(test.notificationsByEntity).not.toHaveBeenCalled();
      expect(toastFailure).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it.each(['unavailable', 'navigating'])(
    'does not hydrate or mark notifications before an accepted open (%s)',
    async (status) => {
      const test = setup(status);
      await test.open();
      expect(fetchChannelNotifications).not.toHaveBeenCalled();
      expect(test.bulkMarkAsRead).not.toHaveBeenCalled();
    }
  );

  it('hydrates once after deferred navigation applies and keeps the pre-navigation identity', async () => {
    const test = setup('navigating');
    const root = sendNotification('root', 'message');
    fetchChannelNotifications.mockResolvedValueOnce([root]);
    await test.open();
    test.channel.id = 'replacement-row';
    const onApplied = test.openWithSplit.mock.calls[0][1]?.onApplied;
    expect(onApplied).toBeDefined();
    onApplied!();
    onApplied!();
    await vi.waitFor(() =>
      expect(test.bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([root])
    );
    expect(fetchChannelNotifications).toHaveBeenCalledOnce();
    expect(fetchChannelNotifications.mock.calls[0][1]).toBe('channel-1');
  });

  it('does not mark a mobile channel read after the user leaves it', async () => {
    vi.mocked(isTouchDevice).mockReturnValue(true);
    const test = setup();
    let resolve!: (notifications: UnifiedNotification[]) => void;
    fetchChannelNotifications.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    await test.open();
    test.isActive.mockReturnValue(false);
    resolve([sendNotification('root', 'message')]);
    await vi.waitFor(() => expect(test.isActive).toHaveBeenCalled());
    expect(test.bulkMarkAsRead).not.toHaveBeenCalled();
    expect(test.openWithSplit).toHaveBeenCalledOnce();
  });

  it('preserves membership gating before starting background hydration', async () => {
    const test = setup();
    test.channel.isParticipant = false;
    await test.open();
    expect(test.openWithSplit).not.toHaveBeenCalled();
    expect(fetchChannelNotifications).not.toHaveBeenCalled();
    expect(test.bulkMarkAsRead).not.toHaveBeenCalled();
  });

  it('keeps notification-targeted inbox opens waiting for their full edge', async () => {
    const test = setup();
    let resolve!: (notifications: UnifiedNotification[]) => void;
    fetchChannelNotifications.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const opening = openEntityInSplitFromUnifiedList(test.channel, {
      notificationSource: test.source,
    });
    expect(test.openWithSplit).not.toHaveBeenCalled();
    resolve([sendNotification('root', 'message')]);
    await opening;
    expect(test.openWithSplit).toHaveBeenCalledOnce();
    expect(targetSearch(test.openWithSplit, 'channels')).toMatchObject({
      messageId: ['message'],
    });
  });
});

describe('channel unread clicks', () => {
  const newer = {
    ...replyNotification('reply', 'newer', 'thread'),
    created_at: '2026-09-24T12:00:00Z',
  };
  const older = {
    ...sendNotification('send', 'older'),
    created_at: '2026-09-23T12:00:00Z',
  };

  it('opens at latest even with unread replies and an empty cached witness', async () => {
    fetchChannelNotifications.mockResolvedValue([
      older,
      newer,
      asRead({
        ...newer,
        id: 'already-read',
        created_at: '2026-09-25T12:00:00Z',
      }),
    ]);
    const channel = await hydrateChannelNotificationSelection({
      type: 'channel',
      id: 'channel-1',
      name: 'Channel',
      ownerId: 'owner',
      channelType: 'private',
      unreadNotifications: [],
    });
    const selection = channelPreviewSelection(channel.id, {
      target: getChannelEntityTarget(channel, {
        channelNavigation: 'latest',
      }),
    });

    expect(selection.target).toBeUndefined();
  });

  it('keeps opening at latest across local reads and new arrivals', async () => {
    fetchChannelNotifications.mockResolvedValue([older, newer]);
    const row = {
      type: 'channel' as const,
      id: 'channel-1',
      name: 'Channel',
      ownerId: 'owner',
      channelType: 'private' as const,
      unreadNotifications: [],
    };
    const readIds = new Set([newer.id]);
    const click = async () => {
      const channel = await hydrateChannelNotificationSelection(row, (n) =>
        readIds.has(n.id) ? asRead(n) : n
      );
      return getChannelEntityTarget(channel, {
        channelNavigation: 'latest',
      });
    };

    expect(await click()).toEqual({ kind: 'latest' });
    readIds.add(older.id);
    expect(await click()).toEqual({ kind: 'latest' });

    fetchChannelNotifications.mockResolvedValue([
      older,
      newer,
      replyNotification('incoming', 'new-arrival', 'thread'),
    ]);
    expect(await click()).toEqual({ kind: 'latest' });
    expect(fetchChannelNotifications).toHaveBeenCalledTimes(3);
  });

  it('builds a route selection with a plain id and ChannelEntityTarget', () => {
    expect(
      channelPreviewSelection('channel-1', {
        target: {
          kind: 'message',
          messageId: 'newer',
          threadId: 'thread',
        },
      })
    ).toEqual({
      type: 'channel',
      id: 'channel-1',
      target: { messageId: 'newer', threadId: 'thread' },
    });
    expect(
      channelPreviewSelection('channel-1', { target: { kind: 'latest' } })
    ).toEqual({ type: 'channel', id: 'channel-1' });
    expect(() => channelPreviewSelection('')).toThrow(/Missing channel id/);
  });

  it('resolves a path channelId and rejects empty selections', () => {
    expect(
      channelIdForPreviewNavigation({ type: 'channel', id: 'channel-1' })
    ).toBe('channel-1');
    expect(
      channelIdForPreviewNavigation({
        type: 'channel_message',
        id: 'msg',
        channelId: 'channel-1',
        messageId: 'msg',
      })
    ).toBe('channel-1');
    expect(() =>
      channelIdForPreviewNavigation({
        type: 'channel',
        id: undefined as unknown as string,
      })
    ).toThrow(/Missing channel id for channel preview navigation/);
    expect(() =>
      channelIdForPreviewNavigation({
        type: 'channel_thread',
        id: 'root',
        channelId: undefined as unknown as string,
        messageId: 'root',
        threadId: 'root',
      })
    ).toThrow(/Missing channel id for channel preview navigation/);
  });

  it('keeps a captured id when the entity proxy later loses its id', () => {
    const entity = {
      type: 'channel' as const,
      id: undefined as unknown as string,
      notifications: () => [newer],
    };
    const selection = channelPreviewSelection('channel-1', {
      target: getChannelEntityTarget(entity, {
        channelNavigation: 'latest',
      }),
      notifications: entity.notifications,
    });
    expect(selection).toMatchObject({
      type: 'channel',
      id: 'channel-1',
    });
    expect(selection).not.toHaveProperty('kind');
    expect(selection.target).toBeUndefined();
  });

  it('opens at latest regardless of current unread state', () => {
    let notifications = [older, newer, { ...newer, id: 'mention' }];
    const row: ChannelPreviewSelection = {
      type: 'channel',
      id: 'channel-1',
      notifications: () => notifications,
    };
    const click = () =>
      getChannelEntityTarget(row, { channelNavigation: 'latest' });
    expect(click()).toEqual({ kind: 'latest' });

    notifications = [older, asRead(newer), asRead({ ...newer, id: 'mention' })];
    expect(click()).toEqual({ kind: 'latest' });

    notifications = notifications.map(asRead);
    expect(click()).toEqual({ kind: 'latest' });
    expect(click()).toEqual({ kind: 'latest' });

    notifications.push({
      ...older,
      id: 'incoming',
      created_at: '2026-09-25T12:00:00Z',
      notification_metadata: {
        ...older.notification_metadata,
        content: {
          ...older.notification_metadata.content,
          messageId: 'incoming',
        },
      },
    } as UnifiedNotification);
    expect(click()).toEqual({ kind: 'latest' });
  });

  it('keeps opening at latest when new notifications arrive', () => {
    let notifications = [older];
    const row: ChannelPreviewSelection = {
      type: 'channel',
      id: 'channel-1',
      notifications: () => notifications,
    };
    expect(
      getChannelEntityTarget(row, { channelNavigation: 'latest' })
    ).toEqual({ kind: 'latest' });
    notifications = [older, newer];
    expect(
      getChannelEntityTarget(row, { channelNavigation: 'latest' })
    ).toEqual({ kind: 'latest' });
  });

  it('preserves Home row targets, including an already-read thread reply', () => {
    const notifications = [
      asRead({
        ...replyNotification('read-reply', 'read-newest', 'thread'),
        created_at: '2026-09-25T12:00:00Z',
      }),
      newer,
      older,
    ];
    expect(getChannelEntityTarget(channelRow({ notifications }))).toMatchObject(
      { messageId: 'older' }
    );
    const thread: ChannelPreviewSelection = {
      type: 'channel_thread',
      id: 'thread',
      channelId: 'channel-1',
      messageId: 'thread',
      threadId: 'thread',
      notifications: () => notifications,
    };
    expect(getChannelEntityTarget(thread)).toEqual({
      kind: 'message',
      messageId: 'read-newest',
      threadId: 'thread',
    });
  });
});

describe('resolveMarkEntitiesDoneVariables', () => {
  it('uses notifications attached to a GraphQL Soup entity', () => {
    const notification = sendNotification('notification-1', 'message-1');
    const notificationSource = {
      notificationsByEntity: () => ({}),
    } as NotificationSource;

    expect(
      resolveMarkEntitiesDoneVariables({
        entities: [channelRow({ notifications: [notification] })],
        notificationSource,
      })
    ).toEqual({
      emailIds: [],
      notificationIds: ['notification-1'],
    });
  });
});

describe('mark-done orchestration', () => {
  const invalidatedEmailList = () =>
    operationMocks.invalidateQueries.mock.calls.some(
      ([options]) =>
        JSON.stringify(options.queryKey) === JSON.stringify(queryKeys.all.email)
    );

  for (const [label, execute] of [
    ['Done', executeMarkEntitiesDone],
    ['Undo', executeMarkEntitiesUndone],
  ] as const) {
    it(`${label} does not invalidate REST email caches while the archive is queued`, async () => {
      operationMocks.archive.mockResolvedValueOnce('queued');
      await execute({ emailIds: ['queued'], notificationIds: [] });
      expect(invalidatedEmailList()).toBe(false);
      expect(operationMocks.invalidateSoupEntity).not.toHaveBeenCalled();
    });
    it(`${label} still reconciles committed and rejected archive writes`, async () => {
      await execute({ emailIds: ['committed'], notificationIds: [] });
      expect(invalidatedEmailList()).toBe(true);
      operationMocks.invalidateQueries.mockClear();
      operationMocks.archive.mockRejectedValueOnce(new Error('archive failed'));
      await expect(
        execute({ emailIds: ['failed'], notificationIds: [] })
      ).rejects.toThrow('archive failed');
      expect(invalidatedEmailList()).toBe(true);
      expect(operationMocks.invalidateSoupEntity).toHaveBeenCalledWith(
        'failed'
      );
    });
    it(`${label} defers shared-list refresh for mixed committed/queued writes`, async () => {
      operationMocks.archive
        .mockResolvedValueOnce('committed')
        .mockResolvedValueOnce('queued');
      await execute({ emailIds: ['committed', 'queued'], notificationIds: [] });
      expect(invalidatedEmailList()).toBe(false);
      expect(operationMocks.invalidateSoupEntity).not.toHaveBeenCalled();
    });
  }

  it.each([false, true])(
    'GraphQL mixed rejection does not refetch accepted email state (per-thread=%s)',
    async (perThread) => {
      operationMocks.graphql = true;
      const failure = new Error('cannot unarchive');
      operationMocks.archive
        .mockResolvedValueOnce('committed')
        .mockRejectedValueOnce(failure);
      const onEmailSettled = perThread ? vi.fn() : undefined;
      await expect(
        executeMarkEntitiesUndone({
          emailIds: ['accepted', 'rejected'],
          notificationIds: [],
          onEmailSettled,
        })
      ).rejects.toBe(failure);
      expect(invalidatedEmailList()).toBe(false);
      expect(operationMocks.invalidateSoupEntity).not.toHaveBeenCalled();
      expect(operationMocks.cancelQueries).not.toHaveBeenCalledWith({
        queryKey: queryKeys.all.email,
      });
      if (onEmailSettled)
        expect(onEmailSettled).toHaveBeenCalledWith('accepted', {
          status: 'fulfilled',
          value: 'committed',
        });
    }
  );

  it('leaves GraphQL success reconciliation to the normalized writer', async () => {
    operationMocks.graphql = true;
    await expect(
      executeMarkEntitiesUndone({ emailIds: ['accepted'], notificationIds: [] })
    ).resolves.toBe('committed');
    expect(invalidatedEmailList()).toBe(false);
    expect(operationMocks.invalidateSoupEntity).not.toHaveBeenCalled();
    expect(operationMocks.invalidateQueries).toHaveBeenCalledTimes(1); // notifications only
  });

  it.each([false, true])(
    'preserves REST notification-only cancellation and reconciliation (failure=%s)',
    async (failure) => {
      if (failure)
        operationMocks.bulkMarkNotificationsAsUndone.mockRejectedValueOnce(
          new Error('failed')
        );
      const write = executeMarkEntitiesUndone({
        emailIds: [],
        notificationIds: ['notification'],
      });
      if (failure) await expect(write).rejects.toThrow('failed');
      else await write;
      expect(operationMocks.cancelQueries).toHaveBeenCalledWith({
        queryKey: queryKeys.all.email,
      });
      expect(invalidatedEmailList()).toBe(true);
    }
  );

  it('reports every unarchive outcome without refreshing over a queued sibling', async () => {
    operationMocks.graphql = true;
    const failure = new Error('thread has no received messages');
    operationMocks.archive
      .mockResolvedValueOnce('committed')
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce('queued');
    const onEmailSettled = vi.fn();
    await expect(
      executeMarkEntitiesUndone({
        emailIds: ['received', 'sent-only', 'queued'],
        notificationIds: [],
        onEmailSettled,
      })
    ).rejects.toBe(failure);
    expect(onEmailSettled.mock.calls).toEqual([
      ['received', { status: 'fulfilled', value: 'committed' }],
      ['sent-only', { status: 'rejected', reason: failure }],
      ['queued', { status: 'fulfilled', value: 'queued' }],
    ]);
    expect(invalidatedEmailList()).toBe(false);
    expect(operationMocks.invalidateSoupEntity).not.toHaveBeenCalled();
  });

  it('reports committed email writes even when notification reversal fails', async () => {
    operationMocks.bulkMarkNotificationsAsUndone.mockRejectedValueOnce(
      new Error('notification failed')
    );
    const onEmailSettled = vi.fn();
    await expect(
      executeMarkEntitiesUndone({
        emailIds: ['received'],
        notificationIds: ['notification'],
        onEmailSettled,
      })
    ).rejects.toThrow('notification failed');
    expect(onEmailSettled).toHaveBeenCalledWith('received', {
      status: 'fulfilled',
      value: 'committed',
    });
  });

  it.each([false, true])(
    'GraphQL notification-only reversal never refreshes shared email lists (failure=%s)',
    async (failure) => {
      operationMocks.graphql = true;
      if (failure)
        operationMocks.bulkMarkNotificationsAsUndone.mockRejectedValueOnce(
          new Error('notification failed')
        );
      const write = executeMarkEntitiesUndone({
        emailIds: [],
        notificationIds: ['notification'],
      });
      if (failure) await expect(write).rejects.toThrow('notification failed');
      else await expect(write).resolves.toBe('committed');
      expect(invalidatedEmailList()).toBe(false);
      expect(operationMocks.cancelQueries).not.toHaveBeenCalledWith({
        queryKey: queryKeys.all.email,
      });
      expect(operationMocks.archive).not.toHaveBeenCalled();
    }
  );

  it('executes entity notification writes directly and returns exact ids', async () => {
    operationMocks.updateNotificationsForEntities.mockResolvedValueOnce([
      { id: 'entity-notification' },
    ]);

    await expect(
      executeMarkEntitiesDone({
        emailIds: [],
        notificationIds: [],
        notificationEntities: [{ type: 'document', id: 'document-1' }],
      })
    ).resolves.toEqual(['entity-notification']);

    expect(operationMocks.updateNotificationsForEntities).toHaveBeenCalledWith({
      entities: [{ type: 'document', id: 'document-1' }],
      operation: 'MARK_DONE',
    });
  });
});

describe('mark-done optimism', () => {
  it('keeps REST Done rollback behavior without creating GraphQL display intent', () => {
    const context = applyEntitiesDoneOptimistic({
      entityIds: ['document-1'],
      emailIds: [],
      notificationIds: ['notification-1'],
    });
    const lease = operationMocks.doneOverride.mock.results[0].value;
    context.rollback();
    context.releaseGraphql();
    expect(hideGraphqlSoupEntitiesAsDone).not.toHaveBeenCalled();
    expect(operationMocks.doneOverride).toHaveBeenLastCalledWith(
      ['notification-1'],
      undefined
    );
    expect(lease).not.toHaveBeenCalled();
    expect(lease.release).not.toHaveBeenCalled();
  });

  it('keeps REST Not Done rollback behavior without creating GraphQL display intent', () => {
    const context = applyEntitiesNotDoneOptimistic({
      emailIds: ['email-1'],
      notificationIds: ['notification-1'],
    });
    const lease = operationMocks.doneOverride.mock.results[0].value;
    context.rollback();
    context.settle();
    expect(hideGraphqlSoupEntitiesAsDone).not.toHaveBeenCalled();
    expect(operationMocks.doneOverride).toHaveBeenLastCalledWith(
      ['notification-1'],
      undefined
    );
    expect(lease).not.toHaveBeenCalled();
  });

  it('hides GraphQL rows until a rollback or undo releases them', () => {
    operationMocks.graphql = true;
    const context = applyEntitiesDoneOptimistic({
      entityIds: ['document-1'],
      emailIds: [],
      notificationIds: ['notification-1'],
    });
    expect(hideGraphqlSoupEntitiesAsDone).toHaveBeenCalledWith({
      entityIds: ['document-1'],
      notificationIds: ['notification-1'],
      scopeChannelThreads: undefined,
    });
    const applied = hideGraphqlSoupEntitiesAsDone.mock.results[0]?.value;

    context.rollback();
    expect(applied?.release).toHaveBeenCalledOnce();

    context.reapply();
    expect(applied?.setDone).toHaveBeenLastCalledWith(true);
    expect(hideGraphqlSoupEntitiesAsDone).toHaveBeenCalledOnce();

    context.applyUndone();
    expect(applied?.setDone).toHaveBeenLastCalledWith(false);
    context.settle(['notification-1', 'authoritative-id']);
    expect(applied?.settle).toHaveBeenCalledWith([
      'notification-1',
      'authoritative-id',
    ]);
    context.releaseGraphql();
    expect(applied?.release).toHaveBeenCalledTimes(2);
  });
});

describe('calendar view navigation', () => {
  it('opens and targets the singleton Calendar route', async () => {
    const openWithSplit = vi.fn(() => ({ status: 'unavailable' }));
    setGlobalSplitManager({
      activeSplit: vi.fn(),
      getSplitByContent: vi.fn(),
      findOpenView: vi.fn(),
      openWithSplit,
    } as unknown as SplitManager);

    await openEntityInSplitFromUnifiedList(
      {
        type: 'calendar_event',
        id: 'event-1',
        notifications: () => [
          {
            notification_metadata: {
              tag: 'calendar_event_reminder',
              content: {
                eventId: 'event-1',
                occurrenceKey: 'instance-1',
                startDate: '2026-01-27',
              },
            },
          } as UnifiedNotification,
        ],
      } as unknown as EntityData,
      {}
    );

    expect(openWithSplit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'component',
        id: 'calendar',
        params: expect.objectContaining({
          eventId: 'event-1',
          occurrenceKey: 'instance-1',
          range: expect.objectContaining({
            startDate: '2026-01-27',
            endDate: '2026-01-28',
          }),
        }),
        entryMetadata: expect.objectContaining({
          route: paneRoute(expect.objectContaining({ id: 'view-calendar' })),
          search: {
            calendar: expect.objectContaining({
              eventId: ['event-1'],
              occurrenceKey: ['instance-1'],
              startDate: ['2026-01-27'],
              endDate: ['2026-01-28'],
            }),
          },
        }),
      }),
      expect.any(Object)
    );
  });

  it('keeps a recurring reminder on its instance through the Calendar route', () => {
    const selection = {
      type: 'calendar_event',
      id: 'event-1',
      time: {
        kind: 'timed',
        startsAt: '2026-05-18T22:00:00Z',
        endsAt: '2026-05-18T22:30:00Z',
      },
      notifications: () => [
        {
          notification_metadata: {
            tag: 'calendar_event_reminder',
            content: {
              eventId: 'event-1',
              occurrenceKey: '2026-09-23T22:00:00+00:00',
              startsAt: '2026-09-23T22:00:00Z',
              endsAt: '2026-09-23T22:30:00Z',
            },
          },
        } as UnifiedNotification,
      ],
    } satisfies CalendarPreviewSelection;
    const target = previewCalendarTarget(selection);
    expect(target).toEqual({
      eventId: 'event-1',
      occurrenceKey: '2026-09-23T22:00:00+00:00',
      range: createCalendarRange({
        kind: 'timed',
        startsAt: '2026-09-23T22:00:00Z',
        endsAt: '2026-09-23T22:30:00Z',
      }),
    });
    expect(
      homeCalendarNavigation(target, 'timeGridWeek')?.search.calendar
    ).toEqual({
      eventId: ['event-1'],
      occurrenceKey: ['2026-09-23T22:00:00+00:00'],
      startDate: [target.range!.startDate],
      endDate: [target.range!.endDate],
    });
  });
});

describe('Hosted details and Drive document routing', () => {
  it('opens GitHub pull requests as Reviews-hosted content', async () => {
    const openWithSplit = vi.fn(() => ({ status: 'unavailable' }));
    setGlobalSplitManager({
      activeSplit: vi.fn(),
      openWithSplit,
    } as unknown as SplitManager);

    await openEntityInSplitFromUnifiedList(
      {
        type: 'foreign',
        id: 'pr-1',
        foreignSource: 'github_pull_request',
        metadata: { url: 'https://github.com/example/repo/pull/1' },
      } as EntityData,
      { openInNewSplit: true }
    );

    expect(openWithSplit).toHaveBeenCalledWith(
      {
        type: 'component',
        id: 'reviews',
        entryMetadata: {
          route: paneRoute(
            { id: 'view-reviews', params: {} },
            { id: 'reviews-pr', params: { foreignEntityId: 'pr-1' } }
          ),
        },
      },
      expect.objectContaining({
        allowDuplicate: true,
        preferNewSplit: true,
      })
    );
  });

  it('keeps task documents as legacy task blocks on touch', async () => {
    vi.mocked(isTouchDevice).mockReturnValue(true);
    const openWithSplit = vi.fn(() => ({ status: 'unavailable' }));
    setGlobalSplitManager({
      activeSplit: vi.fn(),
      getOrchestrator: vi.fn(() => ({})),
      openWithSplit,
    } as unknown as SplitManager);
    await openEntityInSplitFromUnifiedList(
      {
        type: 'document',
        id: 'task-1',
        fileType: 'md',
        subType: { type: 'task' },
      } as EntityData,
      {}
    );
    expect(openWithSplit).toHaveBeenCalledWith(
      { type: 'task', id: 'task-1', params: undefined },
      expect.any(Object)
    );
  });
  it.each([
    'md',
    'pdf',
    'canvas',
    'code',
    'image',
    'video',
    'spreadsheet',
    'unknown',
  ] as const)(
    'opens %s documents as legacy blocks on touch',
    async (fileType) => {
      vi.mocked(isTouchDevice).mockReturnValue(true);
      const openWithSplit = vi.fn(() => ({ status: 'unavailable' }));
      setGlobalSplitManager({
        activeSplit: vi.fn(),
        getOrchestrator: vi.fn(() => ({})),
        openWithSplit,
      } as unknown as SplitManager);
      await openEntityInSplitFromUnifiedList(
        { type: 'document', id: 'doc-1', fileType } as EntityData,
        { openInNewSplit: true }
      );
      expect(openWithSplit).toHaveBeenCalledWith(
        { type: fileType, id: 'doc-1', params: undefined },
        expect.objectContaining({ preferNewSplit: true })
      );
    }
  );
  it.each(['md', 'pdf', 'canvas'] as const)(
    'opens %s documents as canonical Drive content',
    async (fileType) => {
      const openWithSplit = vi.fn(() => ({ status: 'unavailable' }));
      setGlobalSplitManager({
        activeSplit: vi.fn(),
        getOrchestrator: vi.fn(() => ({})),
        getSplitByContent: vi.fn(),
        openWithSplit,
      } as unknown as SplitManager);

      await openEntityInSplitFromUnifiedList(
        {
          type: 'document',
          id: 'doc-1',
          fileType,
        } as EntityData,
        { openInNewSplit: true }
      );

      expect(openWithSplit).toHaveBeenCalledWith(
        {
          type: 'component',
          id: 'documents',
          entryMetadata: {
            route: paneRoute(
              { id: 'drive', params: {} },
              {
                id: 'drive-document',
                params: { documentId: 'doc-1', documentType: fileType },
              }
            ),
          },
        },
        expect.objectContaining({
          allowDuplicate: true,
          preferNewSplit: true,
        })
      );
    }
  );
});

describe('Inbox calendar preview navigation', () => {
  it('targets the Calendar period path with the event and locator in search', () => {
    const range = {
      start: '2025-01-01T00:00:00.000Z',
      end: '2025-01-02T00:00:00.000Z',
      startDate: '2025-01-01',
      endDate: '2025-01-02',
    };
    expect(
      homeCalendarNavigation(
        { eventId: 'event-1', occurrenceKey: 'occurrence-1', range },
        'timeGridWeek'
      )
    ).toEqual({
      params: { period: 'timeGridWeek' },
      search: {
        channels: undefined,
        calendar: {
          eventId: ['event-1'],
          occurrenceKey: ['occurrence-1'],
          startDate: [range.startDate],
          endDate: [range.endDate],
        },
      },
    });
    expect(homeCalendarNavigation({}, 'timeGridWeek')).toBeUndefined();
  });
});

describe('Inbox channel preview navigation', () => {
  it('preserves explicit message targets on whole-channel selections', () => {
    const result = homePreviewNavigation({
      type: 'channel',
      id: 'channel-1',
      target: { messageId: 'message-1', threadId: 'thread-1' },
    });
    expect(result.params).toEqual({
      blockType: 'channel',
      previewId: 'channel-1',
    });
    expect(result.search).toEqual({
      channels: { messageId: ['message-1'], threadId: ['thread-1'] },
    });
  });
  it('keeps untargeted channels at latest', () => {
    expect(
      homePreviewNavigation({ type: 'channel', id: 'channel-1' }).search
    ).toEqual({ channels: undefined });
  });
  it('names markdown subtypes in the path', () => {
    expect(
      homePreviewNavigation({
        type: 'document',
        id: 'task-1',
        fileType: 'md',
        subType: { type: 'task', is_completed: false },
      }).params
    ).toEqual({ blockType: 'task', previewId: 'task-1' });
  });
});

describe('getChannelEntityTarget', () => {
  it('activates a stamped target over attached channel notifications (search message hit)', () => {
    const entity = channelMessageRow({
      target: { messageId: 'hit-msg', threadId: 'hit-thread' },
      notifications: [sendNotification('n1', 'recent-unread-msg')],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      kind: 'message',
      messageId: 'hit-msg',
      threadId: 'hit-thread',
    });
  });

  it('activates a stamped target on a channel_thread row over notifications (future thread hit)', () => {
    const entity = channelThreadRow({
      target: { messageId: 'hit-reply', threadId: 'root-msg' },
      notifications: [replyNotification('n1', 'newest-reply', 'root-msg')],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      kind: 'message',
      messageId: 'hit-reply',
      threadId: 'root-msg',
    });
  });

  it('falls back to own ids for an unstamped channel_message row without notifications', () => {
    expect(getChannelEntityTarget(channelMessageRow())).toEqual({
      kind: 'message',
      messageId: 'hit-msg',
      threadId: 'hit-thread',
    });
  });

  it('targets the driving unread notification for a channel row', () => {
    const entity = channelRow({
      notifications: [sendNotification('n1', 'notif-msg')],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      kind: 'message',
      messageId: 'notif-msg',
      threadId: undefined,
    });
  });

  it('marks every unread notification attached to a channel row', () => {
    const agentNotification = sendNotification(
      'agent-notification',
      'agent-msg'
    );
    agentNotification.notification_metadata = {
      tag: 'channel_message_send',
      content: {
        messageId: 'agent-msg',
        sender: null,
        senderDisplayName: 'Macro Agent',
      },
    } as UnifiedNotification['notification_metadata'];
    const olderNotification = sendNotification('older-notification', 'older');
    const readNotification = asRead(sendNotification('read', 'read-msg'));

    const bulkMarkAsRead = vi.fn(async () => {});
    markChannelNotificationsSeenOnOpen(
      channelRow({
        notifications: [agentNotification, olderNotification, readNotification],
      }),
      notificationSourceWithBulkMarkAsRead(bulkMarkAsRead)
    );

    expect(bulkMarkAsRead).toHaveBeenCalledOnce();
    expect(bulkMarkAsRead).toHaveBeenCalledWith([
      agentNotification,
      olderNotification,
    ]);
  });

  it.each(['channel_mention', 'channel_message_reply'] as const)(
    'leaves threaded %s unread when Chat opens without reading the global feed',
    (tag) => {
      const notification = {
        ...sendNotification('thread-notification', 'message'),
        notification_event_type: tag,
        notification_metadata: {
          tag,
          content: { messageId: 'message', threadId: 'root' },
        },
      } as UnifiedNotification;
      const bulkMarkAsRead = vi.fn(async () => {});
      const notificationsByEntity = vi.fn(() => ({}));
      markChannelNotificationsSeenOnOpen(
        channelRow({ notifications: [notification] }),
        {
          ...notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
          notificationsByEntity,
        },
        { channelReadScope: 'top-level' }
      );
      expect(bulkMarkAsRead).not.toHaveBeenCalled();
      expect(notificationsByEntity).not.toHaveBeenCalled();
    }
  );

  it('marks top-level notifications on repeated Chat opens, skipping replies and local reads', () => {
    const send = sendNotification('send', 'top-level');
    const root = sendNotification('root', 'root');
    const reply = replyNotification('reply', 'reply-message', 'root');
    const mention = {
      ...sendNotification('mention', 'mentioned-message'),
      notification_event_type: 'channel_mention',
      notification_metadata: {
        tag: 'channel_mention',
        content: { messageId: 'mentioned-message' },
      },
    } as UnifiedNotification;
    const read = asRead(sendNotification('seen', 'seen-message'));
    const done = {
      ...sendNotification('done', 'done-message'),
      state: 'done' as const,
    };
    const readIds = new Set<string>();
    const bulkMarkAsRead = vi.fn(
      async (notifications: UnifiedNotification[]) => {
        for (const notification of notifications) readIds.add(notification.id);
      }
    );
    const source: NotificationSource = {
      ...notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
      withLocalOverrides: (notification) =>
        readIds.has(notification.id) ? asRead(notification) : notification,
    };
    const reaction = {
      ...sendNotification('reaction', 'root'),
      notification_event_type: 'channel_message_reaction',
      notification_metadata: {
        tag: 'channel_message_reaction',
        content: { messageId: 'root' },
      },
    } as UnifiedNotification;
    const replyReaction = {
      ...reaction,
      id: 'reply-reaction',
      notification_metadata: {
        tag: 'channel_message_reaction',
        content: { messageId: 'reply', threadId: 'root' },
      },
    } as UnifiedNotification;
    const notifications = [
      send,
      root,
      reply,
      mention,
      reaction,
      replyReaction,
      read,
      done,
    ];
    const channel = channelRow({ notifications });
    const open = () =>
      markChannelNotificationsSeenOnOpen(channel, source, {
        channelReadScope: 'top-level',
      });
    open();
    expect(bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([
      send,
      root,
      mention,
      reaction,
    ]);
    open();
    expect(bulkMarkAsRead).toHaveBeenCalledTimes(1);
    notifications.push(
      replyNotification('incoming-reply', 'new-reply', 'root')
    );
    open();
    expect(bulkMarkAsRead).toHaveBeenCalledTimes(1);
    const incoming = sendNotification('incoming', 'new-root');
    notifications.push(incoming);
    open();
    expect(bulkMarkAsRead).toHaveBeenCalledTimes(2);
    expect(bulkMarkAsRead).toHaveBeenLastCalledWith([incoming]);
  });

  it('marks attached channel notifications through the shared split-open path', async () => {
    const notification = sendNotification('shared-open', 'message');
    const openWithSplit = vi.fn(() => ({ status: 'opened' }));
    setGlobalSplitManager({
      activeSplit: vi.fn(),
      getOrchestrator: vi.fn(() => ({
        getBlockHandle: vi.fn(async () => undefined),
      })),
      getSplitByContent: vi.fn(),
      findOpenView: vi.fn(),
      openWithSplit,
    } as unknown as SplitManager);

    const bulkMarkAsRead = vi.fn(async () => {});
    await openEntityInSplitFromUnifiedList(
      channelRow({ notifications: [notification] }),
      {
        notificationSource:
          notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
      }
    );

    expect(openWithSplit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'channel', id: 'channel-1' }),
      expect.any(Object)
    );
    expect(targetSearch(openWithSplit, 'channels')).toMatchObject({
      messageId: ['message'],
      seek: [expect.any(String)],
    });
    expect(bulkMarkAsRead).toHaveBeenCalledWith([notification]);
  });

  it('preserves the non-member guard after mobile selection hydration', async () => {
    const notification = sendNotification('non-member-unread', 'message');
    fetchChannelNotifications.mockResolvedValueOnce([notification]);
    const openWithSplit = vi.fn(() => ({ status: 'opened' }));
    setGlobalSplitManager({ openWithSplit } as unknown as SplitManager);
    const bulkMarkAsRead = vi.fn(async () => {});
    const channel = await hydrateChannelNotificationSelection({
      type: 'channel',
      id: 'channel-1',
      name: 'Join-only channel',
      ownerId: 'owner',
      channelType: 'team',
      isParticipant: false,
      unreadNotifications: [
        { id: notification.id, state: 'unseen', createdAt: '2026-01-01' },
      ],
    });

    await openEntityInSplitFromUnifiedList(channel, {
      referredFrom: 'channels',
      notificationSource: notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
    });

    expect(fetchChannelNotifications).toHaveBeenCalledOnce();
    expect(openWithSplit).not.toHaveBeenCalled();
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
  });

  it('keeps an explicit channel search target without navigating to latest', async () => {
    const getBlockHandle = vi.fn(async () => undefined);
    const openWithSplit = vi.fn(() => ({ status: 'navigating' }));
    setGlobalSplitManager({
      activeSplit: vi.fn(),
      getOrchestrator: vi.fn(() => ({ getBlockHandle })),
      getSplitByContent: vi.fn(),
      findOpenView: vi.fn(),
      openWithSplit,
    } as unknown as SplitManager);
    await openEntityInSplitFromUnifiedList(channelRow(), {
      location: { type: 'channel', messageId: 'hit' },
    });
    expect(targetSearch(openWithSplit, 'channels')).toMatchObject({
      messageId: ['hit'],
    });
    expect(openWithSplit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ reopen: undefined })
    );
    expect(getBlockHandle).not.toHaveBeenCalled();
  });

  it.each([
    'channels',
    'email-detail',
    'markdown-detail',
    'pdf-detail',
    'agent-detail',
    'call-detail',
  ])('clears stale %s targets on ordinary Home navigation', (namespace) => {
    const navigation = homePreviewNavigation({ type: 'channel', id: 'other' });
    expect(Object.hasOwn(navigation.search, namespace)).toBe(true);
    expect(navigation.search[namespace]).toBeUndefined();
  });

  it.each(
    [false, true].flatMap((openInNewSplit) =>
      ['opened', 'reused', 'unavailable', 'navigating'].map((status) => ({
        openInNewSplit,
        status,
      }))
    )
  )(
    'only marks top-level GraphQL notifications after a successful Chat open (new split=$openInNewSplit, status=$status)',
    async ({ openInNewSplit, status }) => {
      const unread = sendNotification('mobile-unread', 'message');
      const read = asRead(sendNotification('mobile-read', 'read-message'));
      const reply = replyNotification('mobile-reply', 'reply', 'thread-root');
      const bulkMarkAsRead = vi.fn(async () => {});
      const openWithSplit = vi.fn(() => {
        expect(bulkMarkAsRead).not.toHaveBeenCalled();
        return { status };
      });
      setGlobalSplitManager({
        activeSplit: vi.fn(),
        getOrchestrator: vi.fn(() => ({
          getBlockHandle: vi.fn(async () => undefined),
        })),
        getSplitByContent: vi.fn(),
        openWithSplit,
      } as unknown as SplitManager);

      const channel = { ...channelRow(), notifications: [unread, read, reply] };
      await openEntityInSplitFromUnifiedList(channel, {
        referredFrom: 'channels',
        openInNewSplit,
        notificationSource:
          notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
        channelNavigation: 'latest',
        channelReadScope: 'top-level',
      });

      expect(openWithSplit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'channel', id: 'channel-1' }),
        expect.objectContaining({
          referredFrom: 'channels',
          preferNewSplit: openInNewSplit,
        })
      );
      if (status === 'unavailable' || status === 'navigating') {
        expect(bulkMarkAsRead).not.toHaveBeenCalled();
      } else {
        expect(bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([unread]);
        expect(openWithSplit.mock.invocationCallOrder[0]).toBeLessThan(
          bulkMarkAsRead.mock.invocationCallOrder[0]
        );
      }
    }
  );

  it('marks top-level notifications only once after deferred conversation navigation applies', async () => {
    const root = sendNotification('root', 'root-message');
    const reply = replyNotification('reply', 'reply-message', 'root-message');
    const bulkMarkAsRead = vi.fn(async () => {});
    let onApplied: (() => void) | undefined;
    setGlobalSplitManager({
      activeSplit: vi.fn(),
      getOrchestrator: vi.fn(() => ({
        getBlockHandle: vi.fn(async () => undefined),
      })),
      getSplitByContent: vi.fn(),
      openWithSplit: (
        ...[_content, options]: Parameters<SplitManager['openWithSplit']>
      ) => {
        onApplied = options?.onApplied;
        return { status: 'navigating' };
      },
    } as unknown as SplitManager);
    await openEntityInSplitFromUnifiedList(
      channelRow({ notifications: [root, reply] }),
      {
        notificationSource:
          notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
        channelNavigation: 'latest',
        channelReadScope: 'top-level',
      }
    );
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
    expect(onApplied).toBeDefined();
    onApplied!();
    onApplied!();
    expect(bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([root]);
  });

  it('opens a conversation at latest without clearing unread replies', async () => {
    const reply = replyNotification('reply-target', 'reply-message', 'root');
    const openWithSplit = vi.fn(() => ({ status: 'opened' }));
    setGlobalSplitManager({
      activeSplit: vi.fn(),
      getOrchestrator: vi.fn(() => ({
        getBlockHandle: vi.fn(async () => undefined),
      })),
      getSplitByContent: vi.fn(),
      openWithSplit,
    } as unknown as SplitManager);
    const bulkMarkAsRead = vi.fn(async () => {});
    await openEntityInSplitFromUnifiedList(
      channelRow({ notifications: [reply] }),
      {
        notificationSource:
          notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
        channelNavigation: 'latest',
        channelReadScope: 'top-level',
      }
    );
    expect(openWithSplit.mock.calls[0]).toEqual([
      expect.anything(),
      expect.objectContaining({ search: undefined, reopen: 'latest' }),
    ]);
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
  });

  it('uses the global source for channels without an attached notification edge', () => {
    const unread = sendNotification('rest-unread', 'message');
    const bulkMarkAsRead = vi.fn(async () => {});
    const source = {
      ...notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
      notificationsByEntity: () => ({ 'channel@channel-1': [unread] }),
    };

    markChannelNotificationsSeenOnOpen(channelRow(), source);

    expect(bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([unread]);
  });

  it('does not fall back to stale global notifications for an empty GraphQL edge', () => {
    const unread = sendNotification('stale-unread', 'message');
    const bulkMarkAsRead = vi.fn(async () => {});
    const source = {
      ...notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
      notificationsByEntity: () => ({ 'channel@channel-1': [unread] }),
    };

    markChannelNotificationsSeenOnOpen(
      { ...channelRow(), notifications: [] },
      source
    );

    expect(bulkMarkAsRead).not.toHaveBeenCalled();
  });

  it('honors local seen overrides on raw GraphQL notifications', () => {
    const unread = sendNotification('already-marked', 'message');
    const bulkMarkAsRead = vi.fn(async () => {});

    markChannelNotificationsSeenOnOpen(
      { ...channelRow(), notifications: [unread] },
      {
        ...notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
        withLocalOverrides: asRead,
      }
    );

    expect(bulkMarkAsRead).not.toHaveBeenCalled();
  });

  it.each(['latest', 'notification'] as const)(
    'keeps inbox-row reads thread-scoped regardless of navigation (%s)',
    async (channelNavigation) => {
      const parentNotification = {
        ...sendNotification('parent-send', 'message'),
        created_at: '2026-09-23T12:00:00Z',
      };
      const threadNotification = {
        ...replyNotification('thread-reply', 'reply', 'thread-root'),
        created_at: '2026-09-24T12:00:00Z',
      };
      const openWithSplit = vi.fn(() => ({ status: 'opened' }));
      setGlobalSplitManager({
        activeSplit: vi.fn(),
        getOrchestrator: vi.fn(() => ({
          getBlockHandle: vi.fn(async () => undefined),
        })),
        openWithSplit,
      } as unknown as SplitManager);

      const bulkMarkAsRead = vi.fn(async () => {});
      await openEntityInSplitFromUnifiedList(
        channelRow({ notifications: [parentNotification, threadNotification] }),
        {
          openInNewSplit: true,
          channelNavigation,
          channelReadScope: 'inbox-row',
          notificationSource:
            notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
        }
      );

      expect(openWithSplit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'channel', id: 'channel-1' }),
        expect.objectContaining({ preferNewSplit: true })
      );
      const search = targetSearch(openWithSplit, 'channels');
      if (channelNavigation === 'latest') {
        expect(search).toBeUndefined();
      } else {
        expect(search).toMatchObject({
          messageId: ['message'],
          seek: [expect.any(String)],
        });
        expect(search?.threadId).toBeUndefined();
      }
      expect(bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([
        parentNotification,
      ]);
    }
  );

  it('reports failures to mark an attached channel notification read', async () => {
    const error = new Error('mark failed');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const notification = sendNotification('notification', 'message');
    const bulkMarkAsRead = vi.fn(async () => {
      throw error;
    });

    try {
      markChannelNotificationsSeenOnOpen(
        channelRow({ notifications: [notification] }),
        notificationSourceWithBulkMarkAsRead(bulkMarkAsRead)
      );
      await Promise.resolve();

      expect(consoleError).toHaveBeenCalledWith(
        'Failed to mark channel notifications as read',
        error
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('opens a channel row at latest when it has no notifications', () => {
    expect(getChannelEntityTarget(channelRow())).toEqual({ kind: 'latest' });
  });

  it('opens a channel row at latest, skipping read notifications (latest send is your own)', () => {
    const entity = channelRow({
      notifications: [asRead(sendNotification('n1', 'read-msg'))],
    });
    expect(getChannelEntityTarget(entity)).toEqual({ kind: 'latest' });
  });

  it('targets the newest unread notification, skipping newer read ones', () => {
    const entity = channelRow({
      notifications: [
        asRead(sendNotification('n1', 'read-newer-msg')),
        sendNotification('n2', 'unread-older-msg'),
      ],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      kind: 'message',
      messageId: 'unread-older-msg',
      threadId: undefined,
    });
  });

  it('opens a channel row at latest when its only notification is a thread reply', () => {
    const entity = channelRow({
      notifications: [replyNotification('n1', 'reply-msg', 'other-thread')],
    });
    expect(getChannelEntityTarget(entity)).toEqual({ kind: 'latest' });
  });

  it('targets the reply notification scoped to a channel_thread row', () => {
    const entity = channelThreadRow({
      notifications: [
        replyNotification('n1', 'reply-in-other-thread', 'other-thread'),
        replyNotification('n2', 'reply-msg', 'root-msg'),
      ],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      kind: 'message',
      messageId: 'reply-msg',
      threadId: 'root-msg',
    });
  });

  it('targets a read reply notification on a channel_thread row (read state only gates channel rows)', () => {
    const entity = channelThreadRow({
      notifications: [asRead(replyNotification('n1', 'reply-msg', 'root-msg'))],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      kind: 'message',
      messageId: 'reply-msg',
      threadId: 'root-msg',
    });
  });

  it('falls back to the thread root when no notification matches the thread', () => {
    const entity = channelThreadRow({
      notifications: [replyNotification('n1', 'reply-msg', 'other-thread')],
    });
    // The row carries its own ids (root === root). Collapsing that to a
    // top-level target is the decoder's job (see convertTargetMessage), so
    // here it passes through unchanged.
    expect(getChannelEntityTarget(entity)).toEqual({
      kind: 'message',
      messageId: 'root-msg',
      threadId: 'root-msg',
    });
  });

  it('returns undefined for non-channel entities', () => {
    const entity = { type: 'email', id: 'e1' } as unknown as EntityData;
    expect(getChannelEntityTarget(entity)).toBeUndefined();
  });
});

const commentNotification = (
  id: string,
  commentId: string,
  overrides: Partial<UnifiedNotification> = {}
) =>
  ({
    id,
    entity_id: 'doc-1',
    entity_type: 'document',
    state: 'unseen',
    notification_metadata: {
      tag: 'mentioned_in_document_comment',
      content: {
        documentName: 'Plan',
        fileType: 'md',
        commentId,
        threadId: 'thread-1',
        text: 'hey @you',
      },
    },
    ...overrides,
  }) as unknown as UnifiedNotification;

const documentRow = (notifications: UnifiedNotification[]) =>
  ({
    type: 'document',
    id: 'doc-1',
    fileType: 'md',
    notifications: () => notifications,
  }) as unknown as EntityData;

describe('getDocumentCommentTarget', () => {
  it('opens the entity without replaying an older comment after own activity', async () => {
    const notification = commentNotification('old', 'comment-old', {
      created_at: '2026-09-24T20:39:45Z',
    });
    const entity = {
      ...documentRow([notification]),
      notificationDisplayCutoff: '2026-10-01T17:02:49Z',
    };
    expect(getDocumentCommentTarget(entity)).toBeUndefined();
    expect(previewBlockTarget(entity as never).params).toBeUndefined();
    expect(homePreviewNavigation(entity as never).search.drive).toBeUndefined();

    const openWithSplit = vi.fn(() => ({ status: 'unavailable' }));
    setGlobalSplitManager({
      activeSplit: vi.fn(),
      getOrchestrator: vi.fn(() => ({})),
      getSplitByContent: vi.fn(),
      openWithSplit,
    } as unknown as SplitManager);
    await openEntityInSplitFromUnifiedList(entity, {});
    expect(openWithSplit).toHaveBeenCalledWith(
      {
        type: 'component',
        id: 'documents',
        entryMetadata: {
          route: paneRoute(
            { id: 'drive', params: {} },
            {
              id: 'drive-document',
              params: { documentId: 'doc-1', documentType: 'md' },
            }
          ),
        },
      },
      expect.objectContaining({ activate: true, search: undefined })
    );
    expect(notification.state).toBe('unseen');
  });

  it('does not borrow an older comment target for a newer unsupported event', () => {
    const entity = documentRow([
      commentNotification('old', 'comment-old', {
        created_at: '2026-09-24T20:39:45Z',
      }),
      commentNotification('assigned', '', {
        created_at: '2026-10-01T17:02:49Z',
        notification_metadata: {
          tag: 'task_assigned',
          content: { taskId: 'doc-1', assignedBy: 'alice', taskName: 'Plan' },
        },
      }),
    ]);
    expect(getDocumentCommentTarget(entity)).toBeUndefined();
  });

  it('targets the newest comment notification that is not done, read or not', () => {
    expect(
      getDocumentCommentTarget(
        documentRow([
          commentNotification('older', 'comment-older', {
            created_at: '2026-09-20T00:00:00Z',
          }),
          commentNotification('read', 'comment-read', {
            state: 'seen',
            created_at: '2026-09-23T00:00:00Z',
          }),
          commentNotification('done', 'comment-done', {
            state: 'done',
            created_at: '2026-09-23T00:00:00Z',
          }),
          commentNotification('newest', 'comment-newest', {
            created_at: '2026-09-22T00:00:00Z',
          }),
        ])
      )?.params
    ).toEqual({ comment_id: 'comment-read' });
  });

  it('opens a document normally once its comment notifications are done', () => {
    expect(
      getDocumentCommentTarget(
        documentRow([commentNotification('n1', 'comment-1', { state: 'done' })])
      )
    ).toBeUndefined();
  });

  it('ignores documents without notifications', () => {
    expect(
      getDocumentCommentTarget({ type: 'document', fileType: 'md' })
    ).toBeUndefined();
  });

  it('opens the row at its comment like a comment link', async () => {
    const openWithSplit = vi.fn(() => ({ status: 'unavailable' }));
    const goToLocationFromParams = vi.fn();
    const getBlockHandle = vi.fn(async () => ({ goToLocationFromParams }));
    setGlobalSplitManager({
      activeSplit: vi.fn(),
      getOrchestrator: vi.fn(() => ({ getBlockHandle })),
      getSplitByContent: vi.fn(),
      openWithSplit,
    } as unknown as SplitManager);

    await openEntityInSplitFromUnifiedList(
      documentRow([commentNotification('n1', 'comment-1')]),
      {}
    );

    expect(openWithSplit).toHaveBeenCalledWith(
      { type: 'md', id: 'doc-1', params: { comment_id: 'comment-1' } },
      expect.objectContaining({ activate: true })
    );
    expect(getBlockHandle).toHaveBeenCalledWith('doc-1', 'md');
    expect(goToLocationFromParams).toHaveBeenCalledWith({
      comment_id: 'comment-1',
    });
  });

  it('carries the comment through the Inbox preview route', () => {
    const result = homePreviewNavigation(
      documentRow([commentNotification('n1', 'comment-1')]) as never
    );
    expect(result.params).toEqual({ blockType: 'md', previewId: 'doc-1' });
    expect(result.search.drive).toEqual({
      commentId: ['comment-1'],
    });
    const target = homePreviewTarget(result.params, {
      channel: { messageId: '', threadId: '' },
      document: { commentId: 'comment-1' },
    });
    expect(target).toMatchObject({ blockType: 'md', blockId: 'doc-1' });
    expect(target.params).toEqual({ comment_id: 'comment-1' });
  });

  it('passes the comment to a document preview', () => {
    expect(
      previewBlockTarget(
        documentRow([commentNotification('n1', 'comment-1')]) as never
      ).params
    ).toEqual({ comment_id: 'comment-1' });
  });
});

const emailHit = (messageId: string, content: string) => ({
  type: 'email' as const,
  content,
  sender: 'Sender',
  senderId: 'sender-1',
  sentAt: '2026-07-14T00:00:00.000Z',
  location: { type: 'email' as const, messageId },
});

const callHit = (transcriptId: string) => ({
  type: 'call_record' as const,
  id: transcriptId,
  content: 'hit content',
  senderId: 'speaker-1',
  sentAt: '2026-07-14T00:00:00.000Z',
  videoSeconds: 0,
  location: { type: 'call_record' as const, callId: 'call-1', transcriptId },
});

const searchEntity = (
  type: 'email' | 'call',
  contentHitData: unknown[] | null
): EntityData =>
  ({
    type,
    id: `${type}-1`,
    search: {
      nameHighlight: null,
      senderHighlightTerms: null,
      contentHitData,
      source: 'service',
    },
  }) as unknown as EntityData;

describe('getRowClickFallbackLocation', () => {
  it('returns no location for an email row, even with content hits', () => {
    const entity = searchEntity('email', [
      emailHit('old-msg', 'a long matched snippet of text'),
      emailHit('newer-msg', 'short'),
    ]);
    expect(getRowClickFallbackLocation(entity)).toBeUndefined();
  });

  it('returns no location for an email row without search data', () => {
    const entity = { type: 'email', id: 'e1' } as unknown as EntityData;
    expect(getRowClickFallbackLocation(entity)).toBeUndefined();
  });

  it('keeps the snippet-hit fallback for call rows', () => {
    const entity = searchEntity('call', [callHit('seg-1'), callHit('seg-2')]);
    expect(getRowClickFallbackLocation(entity)).toEqual({
      type: 'call_record',
      callId: 'call-1',
      transcriptId: 'seg-1',
    });
  });

  it('returns no location for a call row without content hits', () => {
    const entity = searchEntity('call', null);
    expect(getRowClickFallbackLocation(entity)).toBeUndefined();
  });

  it('returns no location for non-snippet entities', () => {
    const entity = { type: 'document', id: 'd1' } as unknown as EntityData;
    expect(getRowClickFallbackLocation(entity)).toBeUndefined();
  });
});

describe('call navigation', () => {
  it('opens calls in Drive without mounting a call block', async () => {
    const openWithSplit = vi.fn(() => ({ status: 'unavailable' }));
    setGlobalSplitManager({
      activeSplit: () => undefined,
      getOrchestrator: () => ({}),
      openWithSplit,
    } as unknown as SplitManager);

    await openEntityInSplitFromUnifiedList(searchEntity('call', null), {});
    expect(openWithSplit).toHaveBeenCalledWith(
      {
        type: 'component',
        id: 'documents',
        entryMetadata: {
          route: paneRoute(
            { id: 'drive', params: {} },
            { id: 'drive-call', params: { callId: 'call-1' } }
          ),
        },
      },
      expect.objectContaining({ allowDuplicate: true })
    );
  });

  it('carries a transcript target into the Drive call route', async () => {
    const openWithSplit = vi.fn((..._args: unknown[]) => ({
      status: 'unavailable',
    }));
    setGlobalSplitManager({
      activeSplit: () => undefined,
      getOrchestrator: () => ({}),
      openWithSplit,
    } as unknown as SplitManager);

    await openEntityInSplitFromUnifiedList(searchEntity('call', null), {
      location: {
        type: 'call_record',
        callId: 'call-1',
        transcriptId: 'segment-1',
      },
    });
    expect(openWithSplit.mock.calls[0]?.[0]).toMatchObject({
      type: 'component',
      id: 'documents',
      entryMetadata: {
        route: paneRoute(
          { id: 'drive', params: {} },
          { id: 'drive-call', params: { callId: 'call-1' } }
        ),
      },
    });
    expect(targetSearch(openWithSplit, 'call-detail')).toMatchObject({
      transcriptId: ['segment-1'],
      seek: [expect.any(String)],
    });
  });
});

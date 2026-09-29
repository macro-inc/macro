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
const fetchChannelNotifications = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/graphql-notifications', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@service-storage/graphql-notifications')
  >()),
  fetchGraphqlEntityNotifications: fetchChannelNotifications,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { alert: toastAlert },
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
    archive: vi.fn(async (): Promise<'committed' | 'queued'> => 'committed'),
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
    invalidateRemindersById: vi.fn(),
    invalidateSoupEntity: vi.fn(async () => {}),
    openExternalUrl: vi.fn(),
    setReminderCompleted: vi.fn(async () => {}),
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
vi.mock('@queries/reminders/reminders', () => ({
  invalidateRemindersById: operationMocks.invalidateRemindersById,
  setReminderCompleted: operationMocks.setReminderCompleted,
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
    isFeatureEnabled: (flag: Parameters<typeof actual.isFeatureEnabled>[0]) =>
      'key' in flag &&
      (flag.key === 'enable-calendar-ui' || flag.key === 'enable-reminders')
        ? true
        : actual.isFeatureEnabled(flag),
  };
});

import type { SerializedSearchParams } from '@app/lib/split-router';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
import type {
  OpenWithSplitOptions,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { type ChannelEntityTarget, type EntityData, queryKeys } from '@entity';
import type { NotificationSource, UnifiedNotification } from '@notifications';
import { hydrateChannelNotificationSelection } from '@queries/channel/notification-selection';
import {
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
  openEntityInNewTab,
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
  setGlobalSplitManager(undefined);
  setGlobalSplitRouter(undefined);
  vi.clearAllMocks();
  vi.mocked(isTouchDevice).mockReturnValue(false);
});

describe('reminder navigation', () => {
  const reminder = {
    type: 'reminder',
    id: 'reminder-1',
    name: 'Review reminder navigation',
  } as EntityData;

  it.each([false, true])(
    'uses the reminder route for list opening (new split: %s)',
    async (openInNewSplit) => {
      const navigate = vi.fn();
      setGlobalSplitManager({
        activeSplitId: () => 'source',
        activeSplit: () => undefined,
      } as unknown as SplitManager);
      setGlobalSplitRouter({ navigate } as unknown as SplitRouter<SplitId>);

      await openEntityInSplitFromUnifiedList(reminder, { openInNewSplit });

      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        'source',
        '/reminder/reminder-1',
        {
          replace: undefined,
          target: openInNewSplit ? 'new-split' : 'current',
        }
      );
    }
  );

  it('uses the same reminder component URL for a new browser tab', () => {
    openEntityInNewTab({ entity: reminder });

    expect(operationMocks.openExternalUrl).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\/app\/reminder\/reminder-1$/)
    );
  });
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

describe('channel unread clicks', () => {
  const newer = {
    ...replyNotification('reply', 'newer', 'thread'),
    created_at: '2026-09-24T12:00:00Z',
  };
  const older = {
    ...sendNotification('send', 'older'),
    created_at: '2026-09-23T12:00:00Z',
  };

  it('targets the newest unread reply even when the rail has an empty cached witness', async () => {
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
      target: getChannelEntityTarget(channel, { scopeChannelThreads: false }),
    });

    expect(selection.target).toEqual({
      messageId: 'newer',
      threadId: 'thread',
    });
  });

  it('honors local reads while refreshing a stale empty rail row on every click', async () => {
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
      return getChannelEntityTarget(channel, { scopeChannelThreads: false });
    };

    expect(await click()).toMatchObject({
      kind: 'message',
      messageId: 'older',
    });
    readIds.add(older.id);
    expect(await click()).toEqual({ kind: 'latest' });

    fetchChannelNotifications.mockResolvedValue([
      older,
      newer,
      replyNotification('incoming', 'new-arrival', 'thread'),
    ]);
    expect(await click()).toMatchObject({
      kind: 'message',
      messageId: 'new-arrival',
      threadId: 'thread',
    });
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
      target: getChannelEntityTarget(entity, { scopeChannelThreads: false }),
      notifications: entity.notifications,
    });
    expect(selection).toMatchObject({
      type: 'channel',
      id: 'channel-1',
      target: { messageId: 'newer', threadId: 'thread' },
    });
    expect(selection).not.toHaveProperty('kind');
    expect(selection.target).not.toHaveProperty('kind');
  });

  it('reads current unread state on every click without revisiting read targets', () => {
    let notifications = [older, newer, { ...newer, id: 'mention' }];
    const row: ChannelPreviewSelection = {
      type: 'channel',
      id: 'channel-1',
      notifications: () => notifications,
    };
    const click = () =>
      getChannelEntityTarget(row, { scopeChannelThreads: false });
    expect(click()).toEqual({
      kind: 'message',
      messageId: 'newer',
      threadId: 'thread',
    });

    notifications = [older, asRead(newer), asRead({ ...newer, id: 'mention' })];
    expect(click()).toEqual({
      kind: 'message',
      messageId: 'older',
      threadId: undefined,
    });

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
    expect(click()).toMatchObject({ kind: 'message', messageId: 'incoming' });
  });

  it('uses new arrivals immediately while older notifications remain unread', () => {
    let notifications = [older];
    const row: ChannelPreviewSelection = {
      type: 'channel',
      id: 'channel-1',
      notifications: () => notifications,
    };
    expect(
      getChannelEntityTarget(row, { scopeChannelThreads: false })
    ).toMatchObject({ messageId: 'older' });
    notifications = [older, newer];
    expect(
      getChannelEntityTarget(row, { scopeChannelThreads: false })
    ).toMatchObject({ messageId: 'newer' });
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
      reminderIds: [],
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
          route: {
            matches: [
              expect.objectContaining({
                id: 'view-calendar',
              }),
            ],
          },
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
          route: {
            matches: [
              { id: 'view-reviews', params: {} },
              { id: 'reviews-pr', params: { foreignEntityId: 'pr-1' } },
            ],
          },
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
            route: {
              matches: [
                { id: 'drive', params: {} },
                {
                  id: 'drive-document',
                  params: {
                    documentId: 'doc-1',
                    documentType: fileType,
                  },
                },
              ],
            },
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
    'leaves thread %s unread when Chat opens the parent channel without reading the global feed',
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
        }
      );
      expect(bulkMarkAsRead).not.toHaveBeenCalled();
      expect(notificationsByEntity).not.toHaveBeenCalled();
    }
  );

  it('marks unstacked notifications on repeated Chat opens, skipping thread stacks and local reads', () => {
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
    const notifications = [send, root, reply, mention, read, done];
    const channel = channelRow({ notifications });
    const open = () => markChannelNotificationsSeenOnOpen(channel, source);
    open();
    expect(bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([send]);
    open();
    expect(bulkMarkAsRead).toHaveBeenCalledTimes(1);
    notifications.push(
      replyNotification('incoming-reply', 'new-reply', 'root')
    );
    open();
    expect(bulkMarkAsRead).toHaveBeenCalledTimes(1);
    const incoming = sendNotification('incoming', 'new-message');
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
        scopeChannelThreads: false,
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

  it('marks only top-level routed channel notifications after the destination is applied', async () => {
    const unread = sendNotification('deferred-send', 'message');
    const reply = replyNotification('deferred', 'reply-message', 'root');
    const bulkMarkAsRead = vi.fn(async () => {});
    let onApplied: (() => void) | undefined;
    setGlobalSplitManager({
      activeSplit: vi.fn(),
      getOrchestrator: vi.fn(() => ({})),
      openWithSplit: (
        ...[_content, options]: Parameters<SplitManager['openWithSplit']>
      ) => {
        onApplied = options?.onApplied;
        return { status: 'navigating' };
      },
    } as unknown as SplitManager);

    await openEntityInSplitFromUnifiedList(
      channelRow({ notifications: [unread, reply] }),
      {
        notificationSource:
          notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
        scopeChannelThreads: false,
      }
    );
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
    expect(onApplied).toBeDefined();
    onApplied!();
    expect(bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([unread]);
  });

  it('keeps the unread reply target without marking the thread read on a Chat open', async () => {
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
    const bulkMarkAsRead = vi.fn(async () => {
      reply.state = 'seen';
    });
    await openEntityInSplitFromUnifiedList(
      channelRow({ notifications: [reply] }),
      {
        notificationSource:
          notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
        scopeChannelThreads: false,
      }
    );
    expect(targetSearch(openWithSplit, 'channels')).toMatchObject({
      messageId: ['reply-message'],
      threadId: ['root'],
    });
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
    expect(reply.state).toBe('unseen');
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

  it.each([true, false])(
    'keeps parent-channel reads thread-scoped regardless of target scope (%s)',
    async (scopeChannelThreads) => {
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
          scopeChannelThreads,
          notificationSource:
            notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
        }
      );

      expect(openWithSplit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'channel', id: 'channel-1' }),
        expect.objectContaining({ preferNewSplit: true })
      );
      const search = targetSearch(openWithSplit, 'channels');
      expect(search).toMatchObject({
        messageId: [scopeChannelThreads ? 'message' : 'reply'],
        seek: [expect.any(String)],
      });
      expect(search?.threadId).toEqual(
        scopeChannelThreads ? undefined : ['thread-root']
      );
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
          route: {
            matches: [
              { id: 'drive', params: {} },
              { id: 'drive-call', params: { callId: 'call-1' } },
            ],
          },
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
        route: {
          matches: [
            { id: 'drive', params: {} },
            { id: 'drive-call', params: { callId: 'call-1' } },
          ],
        },
      },
    });
    expect(targetSearch(openWithSplit, 'call-detail')).toMatchObject({
      transcriptId: ['segment-1'],
      seek: [expect.any(String)],
    });
  });
});

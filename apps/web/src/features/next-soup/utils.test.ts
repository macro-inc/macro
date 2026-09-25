import { createCalendarRange } from '@app/features/calendar-view/calendar-range';
import {
  previewBlockTarget,
  previewCalendarTarget,
} from '@components/app/previewTarget';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inboxCalendarNavigation,
  inboxPreviewNavigation,
} from '../inbox-view/inbox-preview-navigation';
import { inboxPreviewTarget } from '../inbox-view/inbox-route';

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: vi.fn(() => false),
}));

const toastAlert = vi.hoisted(() => vi.fn());
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
    isFeatureEnabled: (flag: Parameters<typeof actual.isFeatureEnabled>[0]) =>
      'key' in flag && flag.key === 'enable-calendar-ui'
        ? true
        : actual.isFeatureEnabled(flag),
  };
});

import { setGlobalSplitManager } from '@app/signal/splitLayout';
import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { type ChannelEntityTarget, type EntityData, queryKeys } from '@entity';
import type { NotificationSource, UnifiedNotification } from '@notifications';
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
  openEntityInSplitFromUnifiedList,
  resolveMarkEntitiesDoneVariables,
} from './utils';

afterEach(() => {
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

  it('opens the agent block with durable params and retargets it on each snippet click', async () => {
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
        params: { agent_message_turn: '0', agent_message_author: 'user' },
      },
      expect.any(Object)
    );
    await openEntityInSplitFromUnifiedList(entity, {
      location: { type: 'agent', messageTurn: 4, author: 'agent' },
    });
    expect(getBlockHandle).toHaveBeenCalledWith('session');
    expect(goToLocationFromParams).toHaveBeenLastCalledWith({
      agent_message_turn: '4',
      agent_message_author: 'agent',
    });
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
  bulkMarkAsRead = vi.fn(async () => {})
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
      inboxCalendarNavigation(target, 'timeGridWeek')?.search.calendar
    ).toEqual({
      eventId: ['event-1'],
      occurrenceKey: ['2026-09-23T22:00:00+00:00'],
      startDate: [target.range!.startDate],
      endDate: [target.range!.endDate],
    });
  });
});

describe('Hosted details and Drive document routing', () => {
  it('opens GitHub pull requests as Tasks-hosted content', async () => {
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
        id: 'tasks',
        entryMetadata: {
          route: {
            matches: [
              { id: 'view-tasks', params: {} },
              { id: 'tasks-pr', params: { foreignEntityId: 'pr-1' } },
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
      inboxCalendarNavigation(
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
    expect(inboxCalendarNavigation({}, 'timeGridWeek')).toBeUndefined();
  });
});

describe('Inbox channel preview navigation', () => {
  it('preserves explicit message targets on whole-channel selections', () => {
    const result = inboxPreviewNavigation({
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
      inboxPreviewNavigation({ type: 'channel', id: 'channel-1' }).search
    ).toEqual({ channels: undefined });
  });
  it('names markdown subtypes in the path', () => {
    expect(
      inboxPreviewNavigation({
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

  it('marks attached channel notifications through the shared split-open path', async () => {
    const notification = sendNotification('shared-open', 'message');
    const openWithSplit = vi.fn(() => ({ status: 'unavailable' }));
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
      expect.objectContaining({
        params: expect.objectContaining({ channel_message_id: 'message' }),
      }),
      expect.any(Object)
    );
    expect(bulkMarkAsRead).toHaveBeenCalledWith([notification]);
  });

  it('marks raw GraphQL notifications when opening a mobile channel', async () => {
    const unread = sendNotification('mobile-unread', 'message');
    const read = asRead(sendNotification('mobile-read', 'read-message'));
    const reply = replyNotification('mobile-reply', 'reply', 'thread-root');
    const openWithSplit = vi.fn(() => ({ status: 'unavailable' }));
    setGlobalSplitManager({
      activeSplit: vi.fn(),
      getOrchestrator: vi.fn(() => ({
        getBlockHandle: vi.fn(async () => undefined),
      })),
      getSplitByContent: vi.fn(),
      openWithSplit,
    } as unknown as SplitManager);

    const bulkMarkAsRead = vi.fn(async () => {});
    const channel = { ...channelRow(), notifications: [unread, read, reply] };
    await openEntityInSplitFromUnifiedList(channel, {
      referredFrom: 'channels',
      notificationSource: notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
    });

    expect(openWithSplit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'channel', id: 'channel-1' }),
      expect.objectContaining({ referredFrom: 'channels' })
    );
    expect(bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([unread]);
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

  it('does not mark a thread-stack notification when opening its parent channel row', async () => {
    const parentNotification = sendNotification('parent-send', 'message');
    const threadNotification = replyNotification(
      'thread-reply',
      'reply',
      'thread-root'
    );
    setGlobalSplitManager({
      activeSplit: vi.fn(),
      getOrchestrator: vi.fn(() => ({
        getBlockHandle: vi.fn(async () => undefined),
      })),
      getSplitByContent: vi.fn(),
      findOpenView: vi.fn(),
      openWithSplit: vi.fn(() => ({ status: 'unavailable' })),
    } as unknown as SplitManager);

    const bulkMarkAsRead = vi.fn(async () => {});
    await openEntityInSplitFromUnifiedList(
      channelRow({
        notifications: [parentNotification, threadNotification],
      }),
      {
        notificationSource:
          notificationSourceWithBulkMarkAsRead(bulkMarkAsRead),
      }
    );

    expect(bulkMarkAsRead).toHaveBeenCalledWith([parentNotification]);
    expect(bulkMarkAsRead).not.toHaveBeenCalledWith(
      expect.arrayContaining([threadNotification])
    );
  });

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
    const result = inboxPreviewNavigation(
      documentRow([commentNotification('n1', 'comment-1')]) as never
    );
    expect(result.params).toEqual({ blockType: 'md', previewId: 'doc-1' });
    expect(result.search.drive).toEqual({
      commentId: ['comment-1'],
    });
    const target = inboxPreviewTarget(result.params, {
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
        search: { 'call-detail': { transcriptId: ['segment-1'] } },
      },
    });
  });
});

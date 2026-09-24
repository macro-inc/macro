import { createCalendarRange } from '@app/features/calendar-view/calendar-range';
import { previewBlockTarget } from '@components/app/previewTarget';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inboxPreviewNavigation } from '../inbox-view/inbox-preview-navigation';
import { inboxPreviewSelection } from '../inbox-view/inbox-route';

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
          search: { calendar: { eventId: ['event-1'] } },
        }),
      }),
      expect.any(Object)
    );
  });

  it('keeps a recurring reminder on its instance through the Inbox preview route', () => {
    const result = inboxPreviewNavigation({
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
    } as never);
    expect(result.search).toMatchObject({
      occurrenceKey: '2026-09-23T22:00:00+00:00',
      startsAt: '2026-09-23T22:00:00Z',
      endsAt: '2026-09-23T22:30:00Z',
    });

    const selection = inboxPreviewSelection(result.params, result.search);
    expect(previewBlockTarget(selection!).params).toMatchObject({
      eventId: 'event-1',
      occurrenceKey: '2026-09-23T22:00:00+00:00',
      range: createCalendarRange({
        kind: 'timed',
        startsAt: '2026-09-23T22:00:00Z',
        endsAt: '2026-09-23T22:30:00Z',
      }),
    });
  });
});

describe('Drive document routing', () => {
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
  it.each([
    { kind: 'allDay' as const, startDate: '2025-01-01', endDate: '2025-01-03' },
    {
      kind: 'timed' as const,
      startsAt: '2025-01-01T12:00:00.000Z',
      endsAt: '2025-01-01T13:00:00.000Z',
    },
  ])('round-trips $kind event times', (time) => {
    const result = inboxPreviewNavigation({
      type: 'calendar_event',
      id: 'event-1',
      time,
    });
    expect(result.search.calendarTimeKind).toBe(time.kind);
    expect(inboxPreviewSelection(result.params, result.search)).toMatchObject({
      type: 'calendar_event',
      id: 'event-1',
      time,
    });
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
    expect(result.search).toMatchObject({
      targetMessageId: 'message-1',
      targetThreadId: 'thread-1',
    });
  });
  it('keeps untargeted channels at latest', () => {
    expect(
      inboxPreviewNavigation({ type: 'channel', id: 'channel-1' }).search
    ).toMatchObject({
      targetMessageId: '',
      targetThreadId: '',
    });
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
  it('targets the newest unread comment notification', () => {
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
    ).toEqual({ comment_id: 'comment-newest' });
  });

  it('opens a document normally once its comment notifications are read', () => {
    expect(
      getDocumentCommentTarget(
        documentRow([commentNotification('n1', 'comment-1', { state: 'seen' })])
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
    expect(result.search.targetCommentId).toBe('comment-1');
    const selection = inboxPreviewSelection(result.params, result.search);
    expect(selection).toMatchObject({
      type: 'document',
      id: 'doc-1',
      commentTarget: { commentId: 'comment-1' },
    });
    expect(previewBlockTarget(selection!).params).toEqual({
      comment_id: 'comment-1',
    });
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

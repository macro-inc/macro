import type { EntityWithRawNotifications } from '@app/features/soup/entity-notifications';
import type {
  ChannelEntity,
  ChannelThreadEntity,
  DocumentEntity,
  EmailEntity,
  EntityData,
} from '@entity/types/entity';
import { unreadFilterFn } from '@entity/utils/filter';
import type { UnifiedNotification } from '@notifications/types';
import { createMemo, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxTab } from '../types';
import { useInboxEntitiesQuery } from './use-inbox-query';

const mocks = vi.hoisted(() => ({
  features: (): boolean => true,
  notificationsByEntity: vi.fn<() => Record<string, UnifiedNotification[]>>(
    () => ({})
  ),
  withLocalOverrides: vi.fn(
    (notification: UnifiedNotification) => notification
  ),
}));
vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
  ...(await import('@app/features/soup/collection/rows')),
  useSearchContext: () => ({ entityPool: () => [] }),
  createSearchState: vi.fn(),
}));
// Keep data-only query tests independent of unrelated UI barrel dependencies.
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
  ...(await import('@entity/utils/notification')),
  ...(await import('@entity/utils/task-properties')),
  ...(await import('@entity/utils/company-properties')),
}));
vi.mock('@notifications', async () => await import('@notifications/types'));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.features() }),
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: () => mocks.features(),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({
    notificationsByEntity: mocks.notificationsByEntity,
    withLocalOverrides: mocks.withLocalOverrides,
  }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'alice' }));
vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery: () => ({}) }));
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

const NOW = '2026-09-23T12:00:00Z';
const base = { id: 'row', name: 'Row', ownerId: 'alice', updatedAt: NOW };
const documentRow: DocumentEntity = { ...base, type: 'document' };
const emailRow: EmailEntity = {
  ...base,
  type: 'email',
  isRead: false,
  isDraft: false,
  isImportant: true,
  done: false,
};
const channel: ChannelEntity = {
  ...base,
  type: 'channel',
  channelType: 'public',
};
const thread: ChannelThreadEntity = {
  ...base,
  type: 'channel_thread',
  channelId: channel.id,
  messageId: 'root',
  threadId: 'root',
  senderId: 'alice',
  sender: { id: 'alice', type: 'user' },
  content: '',
  attachments: [],
  reactions: [],
  thread: { replyCount: 1, preview: [] },
};
function notification(
  id: string,
  state: UnifiedNotification['state'] = 'unseen',
  metadata: UnifiedNotification['notification_metadata'] = {
    tag: 'channel_message_send',
    content: { messageId: id, channelType: 'public' },
  }
): UnifiedNotification {
  return {
    id,
    entity_id: channel.id,
    entity_type: 'channel',
    state,
    notification_event_type: metadata.tag,
    notification_metadata: metadata,
    created_at: NOW,
    updated_at: NOW,
    sent: true,
    viewed_at: null,
  };
}
function withNotifications<T extends EntityData>(
  entity: T,
  notifications: UnifiedNotification[] | (() => UnifiedNotification[])
): EntityWithRawNotifications<T> {
  return { ...entity, notifications };
}
let dispose: (() => void) | undefined;
function setup(tab: InboxTab = 'signal') {
  return createRoot((cleanup) => {
    dispose = cleanup;
    return useInboxEntitiesQuery({ tab, facets: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date(NOW));
  mocks.features = () => true;
  mocks.notificationsByEntity.mockImplementation(() => ({}));
  mocks.withLocalOverrides.mockImplementation((notification) => notification);
});
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
});

describe('Inbox unread presence', () => {
  it('stops at the first qualifying row and scopes its notifications only once', () => {
    const inbox = setup();
    const first = vi.fn(() => [notification('first')]);
    const later = vi.fn(() => [notification('later')]);
    const rows = [
      withNotifications(channel, first),
      ...Array.from({ length: 99 }, (_, index) =>
        withNotifications({ ...channel, id: `later-${index}` }, later)
      ),
    ];
    expect(inbox.hasUnreadEntity(rows)).toBe(true);
    expect(first).toHaveBeenCalledOnce();
    expect(mocks.withLocalOverrides).toHaveBeenCalledOnce();
    expect(later).not.toHaveBeenCalled();
    expect(mocks.notificationsByEntity).not.toHaveBeenCalled();

    first.mockClear();
    later.mockClear();
    mocks.withLocalOverrides.mockClear();
    expect(inbox.transformEntities(rows).some(unreadFilterFn)).toBe(true);
    expect(first).toHaveBeenCalledTimes(2);
    expect(later).toHaveBeenCalledTimes(99);
    expect(mocks.withLocalOverrides).toHaveBeenCalledTimes(101);
  });

  it('does not read email notifications and stops on an unread, non-archived email', () => {
    const inbox = setup();
    const read = vi.fn(() => []);
    expect(
      inbox.hasUnreadEntity([
        withNotifications({ ...emailRow, isRead: true }, read),
        withNotifications({ ...emailRow, done: true }, read),
        withNotifications(emailRow, read),
        withNotifications(channel, read),
      ])
    ).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it('retains the same answers as list transformation across membership and thread cases', () => {
    const inbox = setup();
    const reply = notification('reply', 'unseen', {
      tag: 'channel_message_reply',
      content: {
        messageId: 'reply',
        threadId: 'root',
        channelType: 'public',
        messageContent: '',
      },
    });
    const mention = notification('mention', 'unseen', {
      tag: 'channel_mention',
      content: { messageId: 'root', channelType: 'public', messageContent: '' },
    });
    const cases: [readonly EntityData[], boolean][] = [
      [[], false],
      [[{ ...emailRow, updatedAt: '2026-08-01T00:00:00Z' }], false],
      [[{ ...emailRow, isRead: true }], false],
      [[{ ...emailRow, done: true }], false],
      [[emailRow], true],
      [[withNotifications(documentRow, [notification('seen', 'seen')])], false],
      [[withNotifications(documentRow, [notification('done', 'done')])], false],
      [[withNotifications(documentRow, [])], false],
      [
        [
          withNotifications(
            { ...documentRow, updatedAt: '2026-08-01T00:00:00Z' },
            [notification('old')]
          ),
        ],
        false,
      ],
      [[withNotifications(documentRow, [notification('fresh')])], true],
      [[withNotifications(channel, [reply])], false],
      [[withNotifications(thread, [reply])], true],
      [[withNotifications({ ...thread, messageId: 'other' }, [reply])], false],
      [[withNotifications(channel, [notification('root'), reply])], false],
      [[withNotifications(channel, [mention])], false],
      [[withNotifications(thread, [mention])], true],
      [[withNotifications(channel, [reply, notification('top-level')])], true],
      [
        [
          withNotifications(channel, [
            {
              ...notification('unrelated'),
              notification_metadata: {
                tag: 'channel_invite',
                content: { channelName: 'Channel', invitedBy: 'alice' },
              },
            },
          ]),
        ],
        false,
      ],
    ];
    for (const [rows, expected] of cases) {
      expect(inbox.hasUnreadEntity(rows)).toBe(expected);
      expect(inbox.hasUnreadEntity(rows)).toBe(
        inbox.transformEntities([...rows]).some(unreadFilterFn)
      );
    }
  });

  it('skips feature-hidden rows without reading their notifications', () => {
    mocks.features = () => false;
    const inbox = setup();
    const read = vi.fn(() => [notification('hidden')]);
    const hidden: EntityData[] = [
      { ...documentRow, fileType: 'md', subType: { type: 'snippet' } },
      {
        ...base,
        type: 'calendar_event',
        status: 'confirmed',
        isReadOnly: false,
      },
      {
        ...base,
        type: 'reminder',
        description: 'Reminder',
        scheduleType: 'once',
        nextRunAt: NOW,
        enabled: true,
      },
      {
        ...base,
        type: 'foreign',
        foreignSource: 'unknown',
        rawForeignSource: 'test',
        foreignId: 'test',
        storedForId: 'team',
        storedForAuthEntity: 'team',
        metadata: {},
      },
    ];
    expect(
      inbox.hasUnreadEntity(hidden.map((row) => withNotifications(row, read)))
    ).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['array', 'accessor', 'global'] as const)(
    'rechecks reactive read/done overrides without caching across calls (%s)',
    (attachment) => {
      const [states, setStates] = createSignal<UnifiedNotification['state'][]>([
        'unseen',
        'unseen',
      ]);
      mocks.withLocalOverrides.mockImplementation((row) => ({
        ...row,
        state: states()[row.id === 'first' ? 0 : 1],
      }));
      const rows = [notification('first'), notification('second')];
      const entities = rows.map((row, index) => {
        const entity = { ...channel, id: String(index) };
        if (attachment === 'global') return entity;
        return withNotifications(
          entity,
          attachment === 'array' ? [row] : () => [row]
        );
      });
      mocks.notificationsByEntity.mockImplementation(() => ({
        'channel@0': [{ ...rows[0], state: states()[0] }],
        'channel@1': [{ ...rows[1], state: states()[1] }],
      }));
      createRoot((cleanup) => {
        dispose = cleanup;
        const inbox = useInboxEntitiesQuery({ tab: 'signal', facets: {} });
        const unread = createMemo(() => inbox.hasUnreadEntity(entities));
        expect(unread()).toBe(true);
        setStates(['seen', 'unseen']);
        expect(unread()).toBe(true);
        setStates(['seen', 'done']);
        expect(unread()).toBe(false);
        setStates(['unseen', 'done']);
        expect(unread()).toBe(true);
      });
    }
  );

  it.each(['signal', 'noise', 'reminders'] as const)(
    'reuses membership for the %s tab',
    (tab) => {
      const inbox = setup(tab);
      const noisyEmail: EmailEntity = {
        ...emailRow,
        id: 'noise',
        labels: [
          {
            id: 'CATEGORY_UPDATES',
            name: 'CATEGORY_UPDATES',
            providerLabelId: 'CATEGORY_UPDATES',
            createdAt: NOW,
            linkId: 'link',
            type: 'system',
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show',
          },
        ],
      };
      const rows = [
        withNotifications(channel, [notification('channel')]),
        emailRow,
        noisyEmail,
        withNotifications(
          {
            ...base,
            type: 'reminder' as const,
            description: 'Reminder',
            scheduleType: 'once' as const,
            nextRunAt: '2026-09-24T12:00:00Z',
            enabled: true,
          },
          [notification('reminder')]
        ),
      ];
      for (const row of rows) {
        expect(inbox.hasUnreadEntity([row])).toBe(
          inbox.transformEntities([row]).some(unreadFilterFn)
        );
      }
    }
  );
});

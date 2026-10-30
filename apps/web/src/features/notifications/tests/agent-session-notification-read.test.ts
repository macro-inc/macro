import { markAgentSessionNotificationsSeenOnOpen } from '@app/features/block-agent/mark-session-notifications-seen';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import type { AgentSessionEntity } from '@entity/types/entity';
import { unreadFilterFn } from '@entity/utils/filter';
import { Telemetry } from '@macro-inc/observability';
import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotificationSource } from '../notification-source';
import type { UnifiedNotification } from '../types';

const mocks = vi.hoisted(() => ({
  seen: vi.fn(),
  entitySeen: vi.fn(),
  feed: vi.fn(() => []),
}));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_DOCUMENT_MENTION_NOTIFICATIONS: true,
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: () => true,
}));
vi.mock('@macro-inc/collaboration/websocket', () => ({
  createSocketEffect: vi.fn(),
}));
vi.mock('@queries/notification/user-notifications', () => ({
  optimisticInsertNotification: vi.fn(),
  useMarkNotificationsAsSeenMutation: () => ({ mutateAsync: mocks.seen }),
  useMarkNotificationsAsDoneMutation: () => ({ mutateAsync: vi.fn() }),
  useUserNotificationsQuery: () => ({
    transport: 'graphql',
    isLoading: false,
    get data() {
      return mocks.feed();
    },
  }),
}));
vi.mock('@queries/notification/notification-soup', () => ({
  updateSoupForNotification: vi.fn(),
}));
vi.mock('@queries/notification/unsubscribes', () => ({
  useMuteItemMutation: () => ({ mutateAsync: vi.fn() }),
  useUnmuteItemMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@queries/notification/entity-mutations', () => ({
  toNotificationEntityRef: vi.fn(() => ({
    type: 'agent_session',
    id: 'session',
  })),
  updateNotificationsForEntities: mocks.entitySeen,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  mapGraphqlNotification: (value: unknown) => value,
}));
vi.mock('@service-storage/graphql-soup-websocket', () => ({
  subscribeToGraphqlNotificationPatches: () => () => {},
}));
vi.mock('../queries/muted-entities-query', () => ({
  createMutedEntitiesQuery: () => ({ isPending: true }),
}));

const session: AgentSessionEntity = {
  type: 'agent_session',
  id: 'session',
  name: 'Fix the flaky test',
  ownerId: 'owner',
  botId: 'bot',
  status: 'idle',
};
const settled: UnifiedNotification = {
  id: 'settled',
  entity_id: session.id,
  entity_type: 'agent_session',
  state: 'unseen',
  notification_event_type: 'agent_session_settled',
  notification_metadata: {
    tag: 'agent_session_settled',
    content: {
      sessionId: session.id,
      sessionName: session.name,
      botId: session.botId,
      botName: 'Macro Coder',
      channelId: 'channel',
      threadId: 'thread',
      turn: 3,
      stopReason: 'end_turn',
      excerpt: 'Done.',
    },
  },
  created_at: '2026-10-23T17:00:00Z',
  updated_at: '2026-10-23T17:00:00Z',
  viewed_at: null,
  sent: true,
};

function createSource() {
  return createRoot((dispose) => ({
    source: createNotificationSource({} as ConnectionGatewayWebsocket),
    dispose,
  }));
}

afterEach(() => vi.restoreAllMocks());

describe('opening agent session notifications', () => {
  it('leaves rows without loaded notifications to the opened session', () => {
    const { source, dispose } = createSource();
    try {
      markAgentSessionNotificationsSeenOnOpen(
        { ...session, notifications: [] },
        source
      );
      expect(mocks.seen).not.toHaveBeenCalled();
      expect(mocks.entitySeen).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it.each(['array', 'accessor'] as const)(
    'clears an attached %s before the write finishes without loading the global feed',
    async (shape) => {
      mocks.feed.mockClear();
      const pending = Promise.withResolvers<void>();
      mocks.seen.mockReturnValueOnce(pending.promise);
      const { source, dispose } = createSource();
      const attached = [
        { ...settled, id: `pending-${shape}` },
        { ...settled, id: `done-${shape}`, state: 'done' as const },
        { ...settled, id: `seen-${shape}`, state: 'seen' as const },
      ];
      const row = {
        ...session,
        notifications: shape === 'array' ? attached : () => attached,
      };
      const rendered = withEntityNotifications(row, source);
      try {
        expect(unreadFilterFn(rendered)).toBe(true);
        markAgentSessionNotificationsSeenOnOpen(row, source);
        expect(unreadFilterFn(rendered)).toBe(false);
        expect(mocks.seen).toHaveBeenLastCalledWith({
          notificationIds: [`pending-${shape}`],
        });
        expect(mocks.feed).not.toHaveBeenCalled();
        pending.resolve();
        await pending.promise;
        expect(unreadFilterFn(withEntityNotifications(row, source))).toBe(
          false
        );
      } finally {
        pending.resolve();
        dispose();
      }
    }
  );

  it('restores the dot after a failed write and clears it on a retry', async () => {
    const pending = Promise.withResolvers<void>();
    const reported = Promise.withResolvers<void>();
    const telemetry = vi
      .spyOn(Telemetry, 'error')
      .mockImplementation(() => reported.resolve());
    mocks.seen.mockReturnValueOnce(pending.promise);
    const { source, dispose } = createSource();
    const row = withEntityNotifications(
      { ...session, notifications: [{ ...settled, id: 'failed-read' }] },
      source
    );
    try {
      markAgentSessionNotificationsSeenOnOpen(row, source);
      expect(unreadFilterFn(row)).toBe(false);
      const error = new Error('offline');
      pending.reject(error);
      await reported.promise;
      expect(telemetry).toHaveBeenCalledWith(error, {
        surface: 'agent-session-notification-read',
      });
      expect(unreadFilterFn(row)).toBe(true);
      mocks.seen.mockResolvedValueOnce(undefined);
      markAgentSessionNotificationsSeenOnOpen(row, source);
      expect(unreadFilterFn(row)).toBe(false);
    } finally {
      dispose();
    }
  });
});

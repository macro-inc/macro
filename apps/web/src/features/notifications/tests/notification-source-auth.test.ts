import {
  JsonSerializer,
  WebsocketBuilder,
} from '@macro-inc/collaboration/websocket';
import type { ToWebsocketMessage } from '@service-connection/generated/schemas/toWebsocketMessage';
import type { FromWebsocketMessage } from '@service-connection/websocket';
import type { UserUnsubscribe } from '@service-notification/generated/schemas';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notifications: vi.fn(),
  muted: vi.fn(),
  mark: vi.fn(),
  readData: vi.fn(() => []),
}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_DOCUMENT_MENTION_NOTIFICATIONS: true,
}));
vi.mock('@queries/notification/user-notifications', () => ({
  useUserNotificationsQuery: mocks.notifications,
  useMarkNotificationsAsDoneMutation: () => ({ mutateAsync: mocks.mark }),
  useMarkNotificationsAsSeenMutation: () => ({ mutateAsync: mocks.mark }),
  optimisticInsertNotification: vi.fn(),
}));
vi.mock('@queries/notification/unsubscribes', () => ({
  createMutedEntitiesQuery: mocks.muted,
  useMuteItemMutation: () => ({ mutateAsync: mocks.mark }),
  useUnmuteItemMutation: () => ({ mutateAsync: mocks.mark }),
}));
vi.mock('@queries/notification/notification-soup', () => ({
  updateSoupForNotification: vi.fn(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  mapGraphqlNotification: vi.fn(),
}));
vi.mock('@service-storage/graphql-soup-websocket', () => ({
  subscribeToGraphqlNotificationPatches: () => () => {},
}));

import { createNotificationSource } from '../notification-source';

afterEach(() => vi.clearAllMocks());

it('disables both feeds without reading pending data or mutating before sign-in', async () => {
  const [enabled, setEnabled] = createSignal(false);
  mocks.notifications.mockReturnValue({
    transport: 'rest',
    get data() {
      return mocks.readData();
    },
  });
  mocks.muted.mockReturnValue({
    get data() {
      return mocks.readData();
    },
  });
  const ws = new WebsocketBuilder('ws://unused')
    .withAutoConnect(false)
    .withSerializer(
      new JsonSerializer<ToWebsocketMessage, FromWebsocketMessage>()
    )
    .build();
  const { source, dispose } = createRoot((dispose) => ({
    source: createNotificationSource(ws, undefined, enabled),
    dispose,
  }));
  try {
    expect(mocks.notifications.mock.calls[0][1]()).toEqual({ enabled: false });
    expect(mocks.muted.mock.calls[0][1]()).toBe(false);
    expect(source.notifications()).toEqual([]);
    expect(source.mutedEntities()).toEqual([]);
    expect(mocks.readData).not.toHaveBeenCalled();
    await source.muteEntity({ type: 'document', id: 'document' });
    expect(mocks.mark).not.toHaveBeenCalled();

    setEnabled(true);
    expect(mocks.notifications.mock.calls[0][1]()).toEqual({ enabled: true });
    expect(mocks.muted.mock.calls[0][1]()).toBe(true);
    source.notifications();
    expect(mocks.readData).toHaveBeenCalled();

    setEnabled(false);
    mocks.readData.mockClear();
    expect(source.notifications()).toEqual([]);
    expect(source.mutedEntities()).toEqual([]);
    await source.unmuteEntity({ type: 'document', id: 'document' });
    expect(mocks.mark).not.toHaveBeenCalled();
    expect(mocks.readData).not.toHaveBeenCalled();
  } finally {
    dispose();
    ws.close();
  }
});

it('does not expose the previous account’s muted items while the next account loads', () => {
  const [enabled, setEnabled] = createSignal(true);
  const [pending, setPending] = createSignal(false);
  const [muted, setMuted] = createSignal<UserUnsubscribe[] | undefined>([
    { item_id: 'alice-document', item_type: 'document' },
  ]);
  mocks.notifications.mockReturnValue({ transport: 'graphql' });
  mocks.muted.mockReturnValue({
    get isPending() {
      return pending();
    },
    get data() {
      return muted();
    },
  });
  const ws = new WebsocketBuilder('ws://unused')
    .withAutoConnect(false)
    .withSerializer(
      new JsonSerializer<ToWebsocketMessage, FromWebsocketMessage>()
    )
    .build();
  const { source, dispose } = createRoot((dispose) => ({
    source: createNotificationSource(ws, undefined, enabled),
    dispose,
  }));
  try {
    expect(source.mutedEntities()).toEqual([
      { item_id: 'alice-document', item_type: 'document' },
    ]);
    setEnabled(false);
    expect(source.mutedEntities()).toEqual([]);
    setPending(true);
    setMuted(undefined);
    setEnabled(true);
    expect(source.mutedEntities()).toEqual([]);

    setMuted([{ item_id: 'bob-channel', item_type: 'channel' }]);
    setPending(false);
    expect(source.mutedEntities()).toEqual([
      { item_id: 'bob-channel', item_type: 'channel' },
    ]);
  } finally {
    dispose();
    ws.close();
  }
});

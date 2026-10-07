import type { ChannelEntity } from '@entity/types/entity';
import type { Notification } from '@entity/types/notification';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelsDataSource } from '../queries';
import type { ChannelsQueryScope } from '../types';

const mocks = vi.hoisted(() => ({
  pass: (props: { children?: JSX.Element }) => props.children,
  hydrate:
    vi.fn<
      typeof import('@queries/channel/notification-selection').hydrateChannelNotificationSelection
    >(),
  openSplit:
    vi.fn<
      typeof import('@app/features/next-soup/utils').openEntityInSplitFromUnifiedList
    >(),
  source: {
    withLocalOverrides: (notification: Notification) => notification,
    mutedEntities: () => [],
  },
  handle: {},
  failure: vi.fn(),
}));
vi.mock('@app/components/list', () => ({ createListController: () => ({}) }));
vi.mock('@app/features/next-soup/actions', () => ({
  toEntityActionListState: () => ({}),
}));
vi.mock('@app/features/next-soup/utils', () => ({
  openEntityInSplitFromUnifiedList: mocks.openSplit,
}));
vi.mock('@app/features/soup', () => ({ SoupEntityContextMenu: mocks.pass }));
vi.mock('@app/lib/debugSettings', () => ({
  DEBUG_SETTING_KEYS: {},
  useDebugSetting: () => () => false,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => mocks.source,
}));
vi.mock('@components/app/mobile/PillTabs', () => ({ PillTabs: () => null }));
vi.mock('@components/app/mobile/PullToRefresh', () => ({
  PullToRefresh: () => null,
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: mocks.pass,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: mocks.handle }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@entity/utils/notification', () => ({ isMutedItem: () => false }));
vi.mock('@queries/channel/notification-selection', () => ({
  hydrateChannelNotificationSelection: mocks.hydrate,
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ height: 0 }),
}));
vi.mock('@ui', () => ({ Button: () => null, EmptyStatePanel: () => null }));
vi.mock('virtua/solid', () => ({
  Virtualizer: (props: {
    data: ChannelEntity[];
    children: (channel: ChannelEntity) => JSX.Element;
  }) => <For each={props.data}>{props.children}</For>,
}));
vi.mock('./ChannelsEmptyState', () => ({ ChannelsEmptyState: () => null }));
vi.mock('./rail/ChannelRailItems', () => ({
  CHANNEL_ACTION_VIEW_CONTEXT: {},
  CONVERSATION_CARD_HEIGHT: 80,
  ConversationCard: (props: {
    channel: ChannelEntity;
    onActivate: () => void;
  }) => <button onClick={props.onActivate}>{props.channel.name}</button>,
}));
vi.mock('./rail/hooks/useChannelCalls', () => ({
  useChannelCalls: () => ({}),
}));
vi.mock('./rail/hooks/useChannelRailActivity', () => ({
  useChannelRailActivity: () => ({
    unreadChannelIds: () => new Set(['one']),
    callStatuses: () => new Map(),
    incomingCallIds: () => new Map(),
  }),
}));

import { ChannelsMobileView } from './ChannelsMobileView';

const channel: ChannelEntity = {
  id: 'one',
  type: 'channel',
  name: 'One',
  ownerId: 'viewer',
  channelType: 'private',
  isParticipant: true,
  unreadNotifications: [
    { id: 'reply-notification', state: 'unseen', createdAt: '2026-01-01' },
  ],
};
const source: ChannelsDataSource = {
  items: () => [channel],
  isLoading: () => false,
  isFetching: () => false,
  error: () => undefined,
  hasMore: () => false,
  isLoadingMore: () => false,
  loadMore: async () => {},
  refresh: async () => {},
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe('mobile channel activation', () => {
  it.each<ChannelsQueryScope>(['recents', 'channels', 'direct_messages'])(
    'opens immediately at latest with top-level read marking from %s',
    async (tab) => {
      render(() => (
        <ChannelsMobileView
          source={source}
          searchQuery=""
          onClearSearch={() => {}}
          tab={tab}
          onTabChange={() => {}}
        />
      ));

      fireEvent.click(screen.getByRole('button', { name: 'One' }));
      expect(mocks.hydrate).not.toHaveBeenCalled();
      expect(mocks.openSplit).toHaveBeenCalledOnce();
      expect(mocks.failure).not.toHaveBeenCalled();

      await waitFor(() =>
        expect(mocks.openSplit).toHaveBeenCalledExactlyOnceWith(channel, {
          splitHandle: mocks.handle,
          referredFrom: 'channels',
          notificationSource: mocks.source,
          channelNavigation: 'latest',
          channelReadScope: 'top-level',
        })
      );
    }
  );

  it('still reports a navigation failure while the list is mounted', async () => {
    const error = new Error('Navigation failed');
    mocks.openSplit.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(() => (
        <ChannelsMobileView
          source={source}
          searchQuery=""
          onClearSearch={() => {}}
          tab="channels"
          onTabChange={() => {}}
        />
      ));
      fireEvent.click(screen.getByRole('button', { name: 'One' }));
      await waitFor(() =>
        expect(mocks.failure).toHaveBeenCalledExactlyOnceWith(
          'Unable to open conversation. Please try again.'
        )
      );
      expect(log).toHaveBeenCalledWith('Failed to open conversation', error);
    } finally {
      log.mockRestore();
    }
  });
});

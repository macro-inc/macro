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
  incomingCallIds: new Map<string, string>(),
}));
vi.mock('@app/components/list', () => ({ createListController: () => ({}) }));
vi.mock('@app/features/next-soup/actions', () => ({
  toEntityActionListState: () => ({}),
}));
vi.mock('@app/features/next-soup/utils', () => ({
  openEntityInSplitFromUnifiedList: mocks.openSplit,
}));
vi.mock('@app/features/soup', () => ({
  SoupEntityContextMenu: (props: { children?: JSX.Element }) => (
    <div>{props.children}</div>
  ),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@app/lib/debugSettings', () => ({
  DEBUG_SETTING_KEYS: {},
  useDebugSetting: () => () => false,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => mocks.source,
}));
vi.mock('@components/app/mobile/PillTabs', () => ({
  PillTabs: () => <div role="tablist" />,
}));
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
vi.mock('@entity', () => ({ Entity: { Icon: () => null } }));
vi.mock('@entity/composed/list-entity/shared', () => ({
  InboxDivider: () => <hr />,
}));
vi.mock(
  '@app/features/next-soup/soup-view/views/inbox/inbox-card-layouts',
  () => ({
    toInboxCardDisplayItem: (entity: ChannelEntity) => ({ entity }),
    ChannelCardLayout: (props: {
      item: { entity: ChannelEntity };
      onClick: (event: MouseEvent) => void;
    }) => <button onClick={props.onClick}>{props.item.entity.name}</button>,
  })
);
vi.mock('@queries/channel/notification-selection', () => ({
  hydrateChannelNotificationSelection: mocks.hydrate,
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ height: 0 }),
}));
vi.mock('@ui', () => ({
  Button: () => null,
  EmptyStatePanel: () => null,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));
vi.mock('virtua/solid', () => ({
  Virtualizer: (props: {
    data: ChannelEntity[];
    children: (channel: ChannelEntity, index: () => number) => JSX.Element;
  }) => <For each={props.data}>{props.children}</For>,
}));
vi.mock('./ChannelsEmptyState', () => ({ ChannelsEmptyState: () => null }));
vi.mock('@channel/Channel/channel-actions', () => ({
  CHANNEL_ACTION_VIEW_CONTEXT: {},
}));
vi.mock('./rail/ChannelRailItems', () => ({
  IncomingCallActions: (props: { callId?: string }) =>
    props.callId ? <button>Join {props.callId}</button> : null,
}));
vi.mock('./rail/hooks/useChannelCalls', () => ({
  useChannelCalls: () => ({}),
}));
vi.mock('./rail/hooks/useChannelRailActivity', () => ({
  useChannelRailActivity: () => ({
    unreadChannelIds: () => new Set(['one']),
    callStatuses: () => new Map(),
    incomingCallIds: () => mocks.incomingCallIds,
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
  mocks.incomingCallIds = new Map();
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('mobile channel activation', () => {
  it('opens recent conversations immediately at latest with top-level read marking', async () => {
    render(() => (
      <ChannelsMobileView
        source={source}
        pinned={[]}
        searchQuery=""
        onClearSearch={() => {}}
      />
    ));

    expect(
      screen.getByRole('tree', { name: 'Recent conversations' })
    ).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
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
  });

  it('still reports a navigation failure while the list is mounted', async () => {
    const error = new Error('Navigation failed');
    mocks.openSplit.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(() => (
        <ChannelsMobileView
          source={source}
          pinned={[]}
          searchQuery=""
          onClearSearch={() => {}}
        />
      ));
      expect(
        screen.getByRole('tree', { name: 'Recent conversations' })
      ).toBeTruthy();
      expect(screen.queryByRole('tablist')).toBeNull();
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

describe('mobile channel press feedback', () => {
  it('highlights a held row and cancels when the finger scrolls or the touch is cancelled', () => {
    vi.useFakeTimers();
    render(() => (
      <ChannelsMobileView
        source={source}
        pinned={[]}
        searchQuery=""
        onClearSearch={() => {}}
      />
    ));
    const button = screen.getByRole('button', { name: 'One' });
    const row = button.closest('[data-soup-entity]')!;
    fireEvent.touchStart(button, { touches: [{ clientX: 20, clientY: 20 }] });
    vi.advanceTimersByTime(20);
    expect(row.classList.contains('touch-highlight')).toBe(true);
    vi.advanceTimersByTime(500);
    expect(row.classList.contains('touch-highlight')).toBe(true);
    expect(mocks.openSplit).not.toHaveBeenCalled();
    fireEvent.touchMove(button, { touches: [{ clientX: 20, clientY: 40 }] });
    expect(row.classList.contains('touch-highlight')).toBe(false);
    fireEvent.touchStart(button, { touches: [{ clientX: 20, clientY: 20 }] });
    vi.advanceTimersByTime(20);
    expect(row.classList.contains('touch-highlight')).toBe(true);
    fireEvent.touchCancel(button);
    expect(row.classList.contains('touch-highlight')).toBe(false);
  });

  it('keeps the tapped row highlighted while navigation is pending and clears after it finishes', async () => {
    vi.useFakeTimers();
    const opened = Promise.withResolvers<void>();
    mocks.openSplit.mockReturnValueOnce(opened.promise);
    render(() => (
      <ChannelsMobileView
        source={source}
        pinned={[]}
        searchQuery=""
        onClearSearch={() => {}}
      />
    ));
    const button = screen.getByRole('button', { name: 'One' });
    const row = button.closest('[data-soup-entity]')!;
    fireEvent.click(button);
    expect(row.classList.contains('touch-highlight')).toBe(true);
    vi.advanceTimersByTime(600);
    expect(row.classList.contains('touch-highlight')).toBe(true);
    opened.resolve();
    await opened.promise;
    await vi.runAllTimersAsync();
    expect(row.classList.contains('touch-highlight')).toBe(false);
  });
});

describe('mobile channel pins', () => {
  const pinnedChannel: ChannelEntity = {
    ...channel,
    id: 'two',
    name: 'Two',
  };
  const both: ChannelsDataSource = {
    ...source,
    items: () => [channel, pinnedChannel],
  };

  it('shows pinned conversations above the list instead of in it, and opens them', async () => {
    render(() => (
      <ChannelsMobileView
        source={both}
        pinned={[pinnedChannel]}
        searchQuery=""
        onClearSearch={() => {}}
      />
    ));

    const pins = screen.getByRole('group', { name: 'Pinned conversations' });
    expect(pins.textContent).toContain('Two');
    expect(screen.getAllByRole('button', { name: 'Two' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'One' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Two' }));
    await waitFor(() =>
      expect(mocks.openSplit).toHaveBeenCalledExactlyOnceWith(
        pinnedChannel,
        expect.objectContaining({ referredFrom: 'channels' })
      )
    );
  });

  it('keeps a pinned conversation in the list while its call rings so it can be joined', () => {
    mocks.incomingCallIds = new Map([['two', 'call-1']]);
    render(() => (
      <ChannelsMobileView
        source={both}
        pinned={[pinnedChannel]}
        searchQuery=""
        onClearSearch={() => {}}
      />
    ));

    expect(
      screen.getByRole('group', { name: 'Pinned conversations' })
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Two' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Join call-1' })).toBeTruthy();
  });

  it('lists pinned conversations normally while searching', () => {
    render(() => (
      <ChannelsMobileView
        source={both}
        pinned={[pinnedChannel]}
        searchQuery="t"
        onClearSearch={() => {}}
      />
    ));

    expect(
      screen.queryByRole('group', { name: 'Pinned conversations' })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Two' })).toBeTruthy();
  });
});

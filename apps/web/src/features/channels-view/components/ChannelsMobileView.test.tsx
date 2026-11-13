import type { ChannelEntity } from '@entity/types/entity';
import type { Notification } from '@entity/types/notification';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createMemo, createRoot, createSignal, For, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
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
  mentionCounts: new Map<string, number>(),
  unreadChannelIds: new Set(['one']),
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
      trailing?: JSX.Element;
      badge?: JSX.Element;
    }) => (
      <div data-testid={`row-${props.item.entity.id}`}>
        <button onClick={props.onClick}>{props.item.entity.name}</button>
        {props.trailing}
        {props.badge}
      </div>
    ),
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
    unreadChannelIds: () => mocks.unreadChannelIds,
    callStatuses: () => new Map(),
    incomingCallIds: () => mocks.incomingCallIds,
    mentionCount: (channelId: string) =>
      mocks.mentionCounts.get(channelId) ?? 0,
  }),
}));

import { ChannelsMobileView } from './ChannelsMobileView';
import { channelsForMobileSection } from './rail/next/mobile/mobile-section-tabs';

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
  mocks.mentionCounts = new Map();
  mocks.unreadChannelIds = new Set(['one']);
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

describe('mobile section hydration', () => {
  it('keeps resolved conversations usable while remaining members load', async () => {
    const [loading, setLoading] = createSignal(true);
    const sectionSource: ChannelsDataSource = {
      ...source,
      isLoading: loading,
      isFetching: loading,
    };
    render(() => (
      <ChannelsMobileView
        source={sectionSource}
        pinned={[]}
        searchQuery=""
        onClearSearch={() => {}}
      />
    ));

    const row = screen.getByRole('button', { name: 'One' });
    fireEvent.click(row);
    await waitFor(() => expect(mocks.openSplit).toHaveBeenCalledOnce());
    setLoading(false);
    setLoading(true);
    expect(screen.getByRole('button', { name: 'One' })).toBe(row);
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

describe('mobile section membership', () => {
  it('reads a large rule section membership once instead of once per conversation', () => {
    const channels = Array.from({ length: 1000 }, (_, index) => ({
      ...channel,
      id: `channel-${index}`,
    }));
    const [memberIds, setMemberIds] = createStore(
      channels.slice(0, 500).map(({ id }) => id)
    );
    let memberReads = 0;
    const trackedIds = new Proxy(memberIds, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) {
          memberReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const label: ChannelLabel = {
      id: 'large-rule',
      name: 'Large rule',
      rule: { attribute: 'name', contains: 'channel' },
      channelIds: trackedIds,
      channelCount: memberIds.length,
      sortOrder: 0,
      createdAt: '',
      updatedAt: '',
    };
    createRoot((dispose) => {
      try {
        const matches = createMemo(() =>
          channelsForMobileSection({
            tab: 'label:large-rule',
            channels,
            labels: [label],
          })
        );
        expect(matches()).toEqual(channels.slice(0, 500));
        expect(memberReads).toBeLessThanOrEqual(memberIds.length);

        memberReads = 0;
        setMemberIds(0, 'channel-999');
        expect(matches()).toEqual([...channels.slice(1, 500), channels[999]]);
        expect(memberReads).toBeLessThanOrEqual(memberIds.length);
      } finally {
        dispose();
      }
    });
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

  it('counts unread mentions on list rows and pins, capped at the edge limit', () => {
    mocks.mentionCounts = new Map([
      ['one', 3],
      ['two', 10],
    ]);
    mocks.unreadChannelIds = new Set(['one', 'two']);
    render(() => (
      <ChannelsMobileView
        source={both}
        pinned={[pinnedChannel]}
        searchQuery=""
        onClearSearch={() => {}}
      />
    ));

    const row = screen.getByTestId('row-one');
    const rowCount = within(row).getByRole('img', {
      name: '3 unread mentions',
    });
    expect(rowCount.textContent).toBe('3');
    const pins = screen.getByRole('group', { name: 'Pinned conversations' });
    const pinCount = within(pins).getByRole('img', {
      name: 'More than 9 unread mentions',
    });
    expect(pinCount.textContent).toBe('9+');
    // A pin with mentions shows the count in place of its unread dot.
    expect(within(pins).queryByLabelText('Unread')).toBeNull();
  });

  it.each([false, true])(
    'keeps a ringing pinned conversation joinable with section tabs enabled: %s',
    (sectionsEnabled) => {
      mocks.incomingCallIds = new Map([['two', 'call-1']]);
      const allSource = {
        ...both,
        items: () =>
          sectionsEnabled
            ? channelsForMobileSection({
                tab: 'all',
                channels: both.items(),
                labels: [],
              })
            : both.items(),
      };
      render(() => (
        <ChannelsMobileView
          source={allSource}
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
    }
  );

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

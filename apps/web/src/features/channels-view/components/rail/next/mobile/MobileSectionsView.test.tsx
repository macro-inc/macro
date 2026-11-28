import type { ChannelEntity } from '@entity';
import type { ChannelIdWindow } from '@queries/channel/window';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelsDataSource } from '../../../../queries';

type ListProps = {
  source: ChannelsDataSource;
  onRowsOnScreen?: (rows: {
    ids: readonly string[];
    start: number;
    end: number;
  }) => void;
  onLoadMore?: () => void;
  children?: JSX.Element;
};

const mocks = vi.hoisted(() => ({
  labels: [] as ChannelLabel[],
  sectionPreferences: {} as Record<string, { unreadOnly?: boolean }>,
  directoryComplete: true,
  list: undefined as ListProps | undefined,
  window: undefined as (() => ChannelIdWindow) | undefined,
  setUnavailable: (_ids: string[]) => {},
  setChannels: (_channels: ChannelEntity[]) => {},
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@app/observability/flow', () => ({
  beginInteraction: () => ({ end: () => {} }),
  useFlow: () => ({ span: { setAttr: () => {} } }),
  usePending: () => {},
}));
vi.mock('@components/app/mobile/PickerSheet', () => ({
  PickerSheet: { Root: () => null },
}));
vi.mock('@components/app/mobile/PillTabs', () => ({
  PillTabs: (props: {
    items: { value: string }[];
    onChange: (value: string) => void;
  }) => (
    <For each={props.items}>
      {(item) => (
        <button onClick={() => props.onChange(item.value)}>{item.value}</button>
      )}
    </For>
  ),
}));
vi.mock('@core/context/channels', () => ({
  useChannelDirectory: () => ({
    complete: () => mocks.directoryComplete,
    failed: () => false,
  }),
}));
vi.mock(
  '@notifications/primitives/create-channel-notification-settings',
  () => ({ createChannelNotificationSettings: () => ({}) })
);
// The real window builder, over lookups that answer as a test says.
vi.mock('@queries/channel/window', async (importOriginal) => {
  const { createSignal } = await import('solid-js');
  return {
    ...(await importOriginal<typeof import('@queries/channel/window')>()),
    useChannelWindow: (window: () => ChannelIdWindow) => {
      const [unavailable, setUnavailable] = createSignal<string[]>([]);
      const [channels, setChannels] = createSignal<ChannelEntity[]>([]);
      mocks.setUnavailable = setUnavailable;
      mocks.setChannels = setChannels;
      mocks.window = window;
      return {
        channels,
        retained: () => [],
        pendingIds: () => new Set<string>(),
        failedIds: () => new Set<string>(),
        unavailableIds: () => new Set(unavailable()),
        error: () => undefined,
        isLoading: () => false,
        retry: async () => {},
      };
    },
  };
});
vi.mock('@queries/channel-labels/channel-labels', () => ({
  useChannelLabelsQuery: (scope?: string) => ({
    data:
      scope === 'personal'
        ? { labels: [] }
        : { teamId: 'team', labels: mocks.labels },
    refetch: async () => {},
  }),
}));
vi.mock('@queries/favorites/favorites', () => ({
  useFavoritesData: () => () => ({ favorites: [] }),
}));
vi.mock('@queries/gate', () => ({ queryReadyGate: () => true }));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ data: undefined }),
}));
vi.mock('../../../../channels-view-context', () => ({
  useChannelsView: () => ({
    state: {
      sectionOrder: [],
      get sectionPreferences() {
        return mocks.sectionPreferences;
      },
    },
    sectionsEnabled: () => true,
    setSectionPreferences: () => {},
    setSectionOrder: () => {},
  }),
}));
vi.mock('../../../../queries', () => ({
  deduplicateChannels: (collections: ChannelEntity[][]) => [
    ...new Map(
      collections.flat().map((channel) => [channel.id, channel])
    ).values(),
  ],
}));
vi.mock('../../../ChannelsMobileView', () => ({
  ChannelsMobileView: (props: ListProps) => {
    mocks.list = props;
    return <>{props.children}</>;
  },
}));
vi.mock('../../hooks/section-notification-menus', () => ({
  sectionNotificationMenus: () => () => ({}),
}));
vi.mock('../collapsed-unread-channels', () => ({
  useCollapsedUnreadChannels: () => () => [],
}));
vi.mock('../SectionChannelsDialog', () => ({
  SectionChannelsPicker: () => null,
}));
vi.mock('./MobileSectionOptions', () => ({
  MobileSectionOptions: () => null,
}));
vi.mock('./use-mobile-section-actions', () => ({
  useMobileSectionActions: () => ({}),
}));

import { MobileSectionsView } from './MobileSectionsView';

const members = Array.from({ length: 300 }, (_, index) => `gone-${index}`);
const recents: ChannelsDataSource = {
  items: () => [],
  isLoading: () => false,
  isFetching: () => false,
  error: () => undefined,
  hasMore: () => false,
  isLoadingMore: () => false,
  loadMore: async () => {},
  refresh: async () => {},
};

/** Open the section's tab, its list empty, as the phone list reports it. */
function openSection() {
  render(() => (
    <MobileSectionsView
      sources={{
        recents,
        direct_messages: recents,
        team_channels: recents,
        channels: recents,
        search: recents,
        threads: recents,
      }}
      pinned={[]}
      localChannels={() => []}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'label:section' }));
  mocks.list!.onRowsOnScreen!({ ids: [], start: 0, end: 0 });
}

const discovered = () =>
  mocks
    .window?.()
    .chunks.filter((chunk) => chunk.key.startsWith('unknown:'))
    .flatMap((chunk) => chunk.ids) ?? [];

beforeEach(() => {
  mocks.labels = [
    {
      id: 'section',
      teamId: 'team',
      name: 'Section',
      channelIds: members,
      channelCount: members.length,
      sortOrder: 0,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];
  mocks.sectionPreferences = {};
  mocks.directoryComplete = true;
  mocks.list = undefined;
  mocks.window = undefined;
});
afterEach(cleanup);

describe('phone section discovery', () => {
  it('walks an empty section past its misses once, then waits for Load more', () => {
    openSection();
    const asked: string[][] = [];
    // Each lookup answers without its members; the window then forgets all
    // but the last batch of misses, as its bounded retention would.
    for (let step = 0; step < 20 && discovered().length > 0; step += 1) {
      const batch = discovered();
      asked.push(batch);
      mocks.setUnavailable(batch);
    }
    expect(asked).toHaveLength(4);
    expect(asked.flat()).toEqual(members.slice(0, 100));
    const source = mocks.list!.source;
    expect(source.isLoading()).toBe(false);
    expect(source.isLoadingMore()).toBe(false);
    expect(source.hasMore()).toBe(false);
    expect(mocks.list!.onLoadMore).toBeTypeOf('function');

    mocks.list!.onLoadMore!();
    expect(discovered()).toEqual(members.slice(100, 125));
    expect(mocks.list!.onLoadMore).toBeUndefined();
    expect(source.isLoading()).toBe(true);
  });

  it('keeps the members it found after the window forgets their records', () => {
    const record = (id: string): ChannelEntity => ({
      id,
      type: 'channel',
      name: id,
      ownerId: 'owner',
      channelType: 'team',
      isParticipant: true,
    });
    openSection();
    expect(discovered()).toEqual(members.slice(0, 25));
    mocks.setChannels(members.slice(0, 25).map(record));
    expect(discovered()).toEqual(members.slice(25, 50));
    // The window now holds only the next batch, and retains nothing.
    mocks.setChannels(members.slice(25, 50).map(record));
    expect(
      new Set(mocks.list!.source.items().map((channel) => channel.id))
    ).toEqual(new Set(members.slice(0, 50)));
  });

  it('looks nothing up while the directory may still bring the members', () => {
    mocks.directoryComplete = false;
    openSection();
    expect(discovered()).toEqual([]);
    expect(mocks.list!.source.isLoading()).toBe(true);
  });

  it('discovers nothing in an Unread only section', () => {
    mocks.sectionPreferences = { 'label:section': { unreadOnly: true } };
    openSection();
    expect(discovered()).toEqual([]);
    expect(mocks.list!.source.isLoading()).toBe(false);
    expect(mocks.list!.onLoadMore).toBeUndefined();
  });
});

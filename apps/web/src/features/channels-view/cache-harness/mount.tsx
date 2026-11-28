/**
 * The desktop Chat sidebar's data path without its UI: the composition
 * `ChannelsRail` and `ChannelsViewMain` build (directory pool, list sources,
 * sections, favorites, referenced channels, collapsed unread, activity) over
 * a fixed sidebar viewport, so a harness can count what it costs.
 *
 * Copied from `components/rail/ChannelsRail.tsx` with the sections flag on;
 * keep it in step when that composition changes. Rows are not rendered: the
 * viewport model below says which ones the virtualizers would mount.
 */
import { fireAndForget } from '@core/util/fireAndForget';
import type { ChannelEntity } from '@entity';
import { useCachedChannelsByIds } from '@queries/channel/by-ids';
import { useChannelLabelsQuery } from '@queries/channel-labels/channel-labels';
import { useFavoritesData } from '@queries/favorites/favorites';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { type Accessor, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ChannelRailRow } from '../components/rail/ChannelsRailContext';
import { useChannelCalls } from '../components/rail/hooks/useChannelCalls';
import { useChannelRailActivity } from '../components/rail/hooks/useChannelRailActivity';
import {
  buildChannelRailRows,
  buildChannelSectionRows,
  groupChannelRailSections,
} from '../components/rail/next/build-channel-rail-rows';
import { useCollapsedUnreadChannels } from '../components/rail/next/collapsed-unread-channels';
import {
  CHANNEL_SECTION_ROW_HEIGHT,
  CHANNELS_DEFAULT_SORT_BY,
} from '../constants';
import { resolveChannelLabelMemberships } from '../core/smart-tags';
import {
  type ChannelsSourceScope,
  type ChannelsSources,
  deduplicateChannels,
  useChannelsSources,
} from '../queries';
import { useChannelListSearchPool } from '../queries/channel-list-search-pool';
import type {
  ChannelSectionKey,
  ChannelsRailSection,
  ChannelsViewState,
} from '../types';

/** A desktop sidebar's list area, in rows (24 × 34px = 816px). */
export const VIEWPORT_ROWS = 24;
/** Rows a section virtualizer mounts past each end of its visible range
 * (`ChannelRailVirtualizer`'s default overscan). */
export const ROW_OVERSCAN = 6;
/** Sections the section stack mounts past the visible ones. */
export const SECTION_OVERSCAN = 3;

/** The rows of one open section on screen, as its virtualizer reports them
 * through `onRangeChange`: indexes into the section's rows, inclusive. */
export type SectionRange = {
  sectionKey: ChannelSectionKey;
  start: number;
  end: number;
};

export type ViewportModel = {
  /** Open sections with rows on screen. */
  ranges: SectionRange[];
  /** Rows the virtualizers mount: each range plus overscan, and the first
   * rows of mounted sections off screen. */
  renderedRows: number;
  /** Ids of the conversations among them. */
  renderedChannelIds: string[];
};

export type ChatDataPath = {
  sources: ChannelsSources;
  /** Every row the rail builds, in order (headings included). */
  rows: Accessor<ChannelRailRow[]>;
  /** Joined channels the directory lists. */
  directoryChannels: Accessor<readonly ChannelEntity[]>;
  viewport(): ViewportModel;
  /** Scrolls the sidebar to `top` pixels. */
  scrollTo(top: number): void;
  setExpanded(section: ChannelsRailSection, open: boolean): void;
  /** What the sections' `loadVisibleSections` does after a range or rows
   * change: pages a list whose status row is near the visible range.
   * Returns the sources it asked for a page. */
  loadVisibleSections(): ChannelsSourceScope[];
};

const INITIAL_STATE: ChannelsViewState = {
  tab: 'browse',
  expandedGroups: {
    favorites: true,
    team_channels: true,
    channels: true,
    direct_messages: true,
  },
  collapsedLabels: [],
  threadsChannelId: undefined,
  sortBy: { ...CHANNELS_DEFAULT_SORT_BY },
  sectionPreferences: {},
  sectionOrder: [],
};

type SectionLayout = {
  key: ChannelSectionKey;
  open: boolean;
  rows: readonly ChannelRailRow[];
  /** Top of the heading, in pixels from the top of the list. */
  top: number;
};

function layoutSections(
  rows: readonly ChannelRailRow[],
  isOpen: (key: ChannelSectionKey) => boolean
): SectionLayout[] {
  const layouts: SectionLayout[] = [];
  let top = 0;
  for (const [key, section] of groupChannelRailSections(rows)) {
    layouts.push({ key, open: isOpen(key), rows: section.rows, top });
    // The heading takes one row; sections keep their natural height.
    top += (1 + section.rows.length) * CHANNEL_SECTION_ROW_HEIGHT;
  }
  return layouts;
}

/** Which rows the section stack and its row virtualizers mount for a
 * viewport at `scrollTop`. */
export function modelViewport(
  rows: readonly ChannelRailRow[],
  isOpen: (key: ChannelSectionKey) => boolean,
  scrollTop: number
): ViewportModel & { visibleSections: SectionLayout[] } {
  const bottom = scrollTop + VIEWPORT_ROWS * CHANNEL_SECTION_ROW_HEIGHT;
  const layouts = layoutSections(rows, isOpen);
  const ranges: SectionRange[] = [];
  const visibleSections: SectionLayout[] = [];
  const renderedChannelIds: string[] = [];
  let renderedRows = 0;
  const visibleIndexes: number[] = [];
  layouts.forEach((layout, index) => {
    const end =
      layout.top + (1 + layout.rows.length) * CHANNEL_SECTION_ROW_HEIGHT;
    if (end > scrollTop && layout.top < bottom) visibleIndexes.push(index);
  });
  const firstMounted = Math.max(0, (visibleIndexes[0] ?? 0) - SECTION_OVERSCAN);
  const lastMounted = Math.min(
    layouts.length - 1,
    (visibleIndexes.at(-1) ?? -1) + SECTION_OVERSCAN
  );
  const mount = (layout: SectionLayout, from: number, to: number) => {
    for (const row of layout.rows.slice(from, to + 1)) {
      renderedRows += 1;
      if (row.kind === 'conversation') renderedChannelIds.push(row.channel.id);
      if (row.kind === 'favorite')
        renderedChannelIds.push(row.favorite.entityId);
    }
  };
  for (let index = firstMounted; index <= lastMounted; index += 1) {
    const layout = layouts[index];
    if (!layout || layout.rows.length === 0) continue;
    const rowsTop = layout.top + CHANNEL_SECTION_ROW_HEIGHT;
    const first = Math.max(
      0,
      Math.floor((scrollTop - rowsTop) / CHANNEL_SECTION_ROW_HEIGHT)
    );
    const last = Math.min(
      layout.rows.length - 1,
      Math.floor((bottom - 1 - rowsTop) / CHANNEL_SECTION_ROW_HEIGHT)
    );
    if (first <= last) {
      visibleSections.push(layout);
      if (layout.open)
        ranges.push({ sectionKey: layout.key, start: first, end: last });
      mount(
        layout,
        Math.max(0, first - ROW_OVERSCAN),
        Math.min(layout.rows.length - 1, last + ROW_OVERSCAN)
      );
    } else {
      // Off screen, a virtualizer's range sits at its nearest edge.
      const below = rowsTop >= bottom;
      mount(
        layout,
        below ? 0 : Math.max(0, layout.rows.length - 1 - ROW_OVERSCAN),
        below ? ROW_OVERSCAN : layout.rows.length - 1
      );
    }
  }
  return { ranges, renderedRows, renderedChannelIds, visibleSections };
}

export function ChatDataPathMount(props: {
  onReady: (path: ChatDataPath) => void;
  /** Called with each open section's range after the viewport or rows
   * change, as `BrowseSection`'s virtualizer reports it. */
  onSectionRange?: (range: SectionRange) => void;
}) {
  const [state, setState] = createStore<ChannelsViewState>(
    structuredClone(INITIAL_STATE)
  );
  const [view, setView] = createStore({ scrollTop: 0 });
  const tab = () => state.tab;
  // The sections flag is on and loaded, so the rail mounts at once.
  const sectionsEnabled = () => true;
  const channelTagsEnabled = () => true;

  // channels-view.tsx: the directory's channels seed the sources.
  const localChannels = useChannelListSearchPool();
  const sources = useChannelsSources(
    (scope) => {
      if (scope === 'search') return false;
      if (scope === 'recents') return tab() === 'recents';
      if (scope === 'threads') return tab() === 'threads';
      return tab() === 'browse';
    },
    (group) => state.sortBy[group],
    localChannels
  );

  // ChannelsRail.tsx from here.
  const favoritesData = useFavoritesData({ entityType: ['channel'] });
  const channelCalls = useChannelCalls();
  const channels = createMemo(() =>
    deduplicateChannels([
      sources.team_channels.items(),
      sources.channels.items(),
      sources.direct_messages.items(),
      sources.recents.items(),
      sources.search.items(),
    ])
  );
  const labelsQuery = useChannelLabelsQuery();
  const personalLabelsQuery = useChannelLabelsQuery(
    'personal',
    sectionsEnabled
  );
  const labels = createMemo<readonly ChannelLabel[]>(() => {
    if (!channelTagsEnabled()) return [];
    const shared =
      !labelsQuery.isPending && labelsQuery.data?.teamId
        ? labelsQuery.data.labels
        : [];
    const personal = !personalLabelsQuery.isPending
      ? (personalLabelsQuery.data?.labels ?? [])
      : [];
    return resolveChannelLabelMemberships([...shared, ...personal], channels());
  });
  const favorites = createMemo(() => favoritesData()?.favorites ?? []);
  const favoriteChannelIds = createMemo(() =>
    favorites()
      .filter((favorite) => favorite.entityType === 'channel')
      .map((favorite) => favorite.entityId)
  );
  const referencedChannelIds = createMemo(() => [
    ...new Set([
      ...labels().flatMap((label) => label.channelIds),
      ...favoriteChannelIds(),
    ]),
  ]);
  const missingChannelIds = createMemo(() => {
    const loaded = new Set(channels().map((channel) => channel.id));
    return referencedChannelIds().filter((id) => !loaded.has(id));
  });
  const nextReferencedChannels = useCachedChannelsByIds(
    missingChannelIds,
    sectionsEnabled
  );
  const referencedChannels = createMemo<ChannelEntity[]>(() =>
    nextReferencedChannels.channels()
  );
  const labelledChannels = createMemo<ChannelEntity[]>(() => {
    const labelled = new Set(labels().flatMap((label) => label.channelIds));
    return referencedChannels().filter((channel) => labelled.has(channel.id));
  });
  const collapsedUnreadSource = useCollapsedUnreadChannels(() =>
    (['team_channels', 'channels', 'direct_messages'] as const).some(
      (section) =>
        !state.expandedGroups[section] &&
        state.sectionPreferences[section]?.unreadWhenCollapsed !== false
    )
  );
  const collapsedUnread = () => collapsedUnreadSource();
  const allChannels = createMemo(() =>
    deduplicateChannels([channels(), labelledChannels(), collapsedUnread()])
  );
  const channelsById = createMemo(
    () => new Map(allChannels().map((channel) => [channel.id, channel]))
  );
  const channelById = (channelId: string) =>
    channelsById().get(channelId) ??
    referencedChannels().find((channel) => channel.id === channelId);
  const favoriteChannels = createMemo(() =>
    favoriteChannelIds().flatMap((id) => channelById(id) ?? [])
  );
  const activityChannels = createMemo(() =>
    deduplicateChannels([allChannels(), favoriteChannels()])
  );
  const channelActivity = useChannelRailActivity(
    activityChannels,
    channelCalls,
    favoriteChannels
  );
  const isLabelOpen = (labelId: string) =>
    !state.collapsedLabels.includes(labelId);
  const channelSectionRows = createMemo(() =>
    buildChannelSectionRows({
      labels: labels(),
      channels: deduplicateChannels([
        sources.team_channels.items(),
        labelledChannels(),
      ]),
      channelsById: channelsById(),
      isLabelOpen: () => true,
    })
  );
  const referenceStatuses = createMemo(() => {
    const statuses: Partial<Record<ChannelSectionKey, 'loading' | 'error'>> =
      {};
    const pending = nextReferencedChannels.pendingIds();
    const failed = nextReferencedChannels.failedIds();
    const statusFor = (ids: readonly string[]) => {
      if (ids.some((id) => failed.has(id) && !channelById(id))) return 'error';
      if (ids.some((id) => pending.has(id) && !channelById(id)))
        return 'loading';
    };
    if (state.expandedGroups.favorites) {
      const status = statusFor(favoriteChannelIds());
      if (status === 'error') statuses.favorites = status;
    }
    for (const label of labels()) {
      if (isLabelOpen(label.id)) {
        statuses[`label:${label.id}`] = statusFor(label.channelIds);
      }
    }
    return statuses;
  });
  const unreadForCollapsedGroup = (
    group: 'team_channels' | 'channels' | 'direct_messages'
  ) => {
    if (
      state.expandedGroups[group] ||
      state.sectionPreferences[group]?.unreadWhenCollapsed === false
    ) {
      return [];
    }
    return collapsedUnread();
  };
  const visibleRows = createMemo(() => {
    const items = {
      favorites: favorites().filter(
        (favorite) =>
          favorite.entityType !== 'channel' ||
          !nextReferencedChannels.unavailableIds().has(favorite.entityId)
      ),
      team_channels: deduplicateChannels([
        sources.team_channels.items(),
        unreadForCollapsedGroup('team_channels').filter(
          (channel) => channel.channelType === 'team'
        ),
      ]),
      channels: deduplicateChannels([
        sources.channels.items(),
        unreadForCollapsedGroup('channels').filter(
          (channel) =>
            channel.channelType === 'public' ||
            channel.channelType === 'private'
        ),
      ]),
      direct_messages: deduplicateChannels([
        sources.direct_messages.items(),
        unreadForCollapsedGroup('direct_messages').filter(
          (channel) => channel.channelType === 'direct_message'
        ),
      ]),
      recents: sources.recents.items(),
      threads: sources.threads.items(),
    };
    return buildChannelRailRows(
      tab(),
      state.expandedGroups,
      items,
      channelSectionRows(),
      {
        preferences: state.sectionPreferences,
        isLabelOpen,
        order: state.sectionOrder,
        channelById,
        unreadChannelIds: channelActivity.unreadOrMentionedChannelIds(),
        referenceStatuses: referenceStatuses(),
      }
    );
  });
  // ChannelsRail.tsx ends here.

  const isOpen = (key: ChannelSectionKey) =>
    key.startsWith('label:')
      ? isLabelOpen(key.slice('label:'.length))
      : state.expandedGroups[key as ChannelsRailSection];
  const viewport = () => modelViewport(visibleRows(), isOpen, view.scrollTop);

  props.onReady({
    sources,
    rows: visibleRows,
    directoryChannels: localChannels,
    viewport: () => {
      const { ranges, renderedRows, renderedChannelIds } = viewport();
      return { ranges, renderedRows, renderedChannelIds };
    },
    scrollTo: (top) => setView('scrollTop', Math.max(0, top)),
    setExpanded: (section, open) => setState('expandedGroups', section, open),
    loadVisibleSections: () => {
      const model = viewport();
      const asked: ChannelsSourceScope[] = [];
      for (const range of model.ranges) {
        props.onSectionRange?.(range);
        const section = model.visibleSections.find(
          (layout) => layout.key === range.sectionKey
        );
        const first = Math.max(0, range.start - 3);
        for (const row of section?.rows.slice(first, range.end + 6) ?? []) {
          if (row.kind !== 'status') continue;
          const source = sources[row.group];
          if (source.hasMore() && !source.isFetching() && !source.error()) {
            asked.push(row.group);
            fireAndForget(source.loadMore(), 'cache-harness');
          }
        }
      }
      return asked;
    },
  });
  return null;
}

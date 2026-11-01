import { SearchBar, ViewSidebar } from '@app/components/view-shell';
import { SlackImportSidebar } from '@app/features/slack-import/slack-import-sidebar';
import { t } from '@app/lib/i18n';
import { createScrollTopFade } from '@core/util/createScrollTopFade';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ChannelEntity } from '@entity';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import StarIcon from '@icon/system/regular/star.svg';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import {
  CHANNEL_SECTION_MIN_HEIGHT,
  CHANNEL_SECTION_ROW_HEIGHT,
} from '../../../constants';
import { canLabelChannel } from '../../../core/channel-label-eligibility';
import { ChannelsLiveCallsSidebar } from '../../../live-calls-sidebar';
import { CHANNELS_TOUR } from '../../../tour';
import type { ChannelSectionKey, ChannelsGroup } from '../../../types';
import { ConversationsCreateMenu } from '../../ConversationsCreateMenu';
import { ChannelOption } from '../ChannelOption';
import {
  type ChannelRailRow,
  domIdForRow,
  rowKeyForSection,
  useChannelsRail,
} from '../ChannelsRailContext';
import {
  RailListError,
  RailListLoading,
  RailListLoadingMore,
} from '../ChannelsRailSection';
import { useChannelRailVirtualizer } from '../hooks/useChannelRailState';
import {
  type ChannelRailSectionRows,
  groupChannelRailSections,
} from './build-channel-rail-rows';
import { ChannelFavoriteRow } from './ChannelFavoriteRow';
import { ChannelLabelRow } from './ChannelLabelRows';
import { ChannelSectionHeading } from './ChannelSectionHeading';
import {
  ChannelSectionContextMenu,
  ChannelSectionDropdown,
} from './ChannelSectionMenu';
import { ResizableRailSection } from './ResizableRailSection';
import { useFavoriteReorder } from './useFavoriteReorder';

type ChannelRailSearch = {
  isOpen: Accessor<boolean>;
  query: Accessor<string>;
  results: Accessor<readonly ChannelEntity[]>;
  isLoading: Accessor<boolean>;
  error: Accessor<unknown | undefined>;
  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  registerInput: (element: HTMLInputElement) => void;
  retry: () => Promise<void>;
};

function ExpandedHeader(props: { search: ChannelRailSearch }) {
  const rail = useChannelsRail();
  return (
    <div class="flex shrink-0 flex-col">
      <ViewSidebar.Header
        searchLabel={t('channelSections.search')}
        searchOpen={props.search.isOpen()}
        onSearchOpenChange={(open) =>
          open ? props.search.open() : props.search.close()
        }
        search={() => (
          <SearchBar
            ref={props.search.registerInput}
            label={t('channelSections.search')}
            placeholder={t('channelSections.search')}
            value={props.search.query()}
            hotkey="cmd+f"
            onValueChange={props.search.setQuery}
            onEscape={() => {
              if (!props.search.query()) props.search.close();
            }}
          />
        )}
      >
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton />
          <ViewSidebar.Title>{t('channelSections.chat')}</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Primary class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <ConversationsCreateMenu
            presentation="sidebar"
            onCreateSection={
              rail.channelTagsEnabled()
                ? () => fireAndForget(rail.createLabel([]), 'channels-view')
                : undefined
            }
            sectionDisabledReason={
              !rail.labelsAvailable()
                ? rail.labelsUnavailableReason()
                : undefined
            }
          />
        </div>
      </ViewSidebar.Primary>
      <Show when={rail.channelTagsEnabled() && !rail.labelsAvailable()}>
        <div
          class="flex items-center gap-2 px-3 text-xs text-ink-muted"
          role="status"
        >
          <span class="min-w-0 flex-1">{rail.labelsUnavailableReason()}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fireAndForget(rail.retryLabels(), 'channels-view')}
          >
            {t('channelSections.retry')}
          </Button>
        </div>
      </Show>
    </div>
  );
}

function SectionHeading(props: { group: 'favorites' | ChannelsGroup }) {
  const rail = useChannelsRail();
  const team = useCurrentTeamQuery(() => props.group === 'team_channels');
  const title = () => {
    const teamName =
      props.group === 'team_channels' && queryReadyGate(team)
        ? team.data?.team.name
        : undefined;
    return teamName
      ? t('channelSections.namedTeamChannels', { name: teamName })
      : t(`channelSections.${props.group}`);
  };
  const open = () => rail.isGroupOpen(props.group);
  const key = () => rowKeyForSection(props.group);
  const channelGroup = () =>
    props.group === 'favorites' ? undefined : props.group;
  const unreadCount = () => {
    const group = channelGroup();
    return group ? rail.channelActivity.unreadCount(group) : 0;
  };
  const icon = () => {
    if (props.group === 'favorites') {
      return <StarIcon aria-hidden="true" class="size-3.5 shrink-0" />;
    }
    if (props.group === 'direct_messages') {
      return <ChatIcon aria-hidden="true" class="size-3.5 shrink-0" />;
    }
  };
  return (
    <ChannelSectionContextMenu section={props.group}>
      <ChannelSectionHeading
        id={domIdForRow(rail.railId, key())}
        title={title()}
        label={title()}
        icon={icon()}
        open={open()}
        focused={rail.list.focus.key() === key()}
        unreadCount={unreadCount()}
        onToggle={() => rail.toggleGroup(props.group)}
      >
        <ChannelSectionDropdown section={props.group} label={title()} />
      </ChannelSectionHeading>
    </ChannelSectionContextMenu>
  );
}

function SectionStatus(props: { group: ChannelsGroup }) {
  const rail = useChannelsRail();
  const source = () => rail.sources[props.group];
  const hasConversations = () =>
    rail.list.items
      .all()
      .some(
        (row) =>
          row.kind === 'conversation' &&
          row.group === props.group &&
          !row.labelId
      );
  return (
    <div>
      <Switch>
        <Match when={source().isLoading() || source().isLoadingMore()}>
          <RailListLoadingMore variant="channel" />
        </Match>
        <Match when={source().error()}>
          <RailListError retry={source().refresh} compact />
        </Match>
        <Match when={source().hasMore()}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fireAndForget(source().loadMore(), 'channels-view')}
          >
            {t('channelSections.loadMore')}
          </Button>
        </Match>
        <Match when={!hasConversations()}>
          <p class="px-(--sidebar-item-inset) py-2 text-xs text-ink-extra-muted">
            {rail.sectionPreferences(props.group).unreadOnly
              ? t('channelSections.noUnreadConversations')
              : t('channelSections.empty')}
          </p>
        </Match>
      </Switch>
    </div>
  );
}

function BrowseRow(props: {
  row: ChannelRailRow;
  favoriteReorder: ReturnType<typeof useFavoriteReorder>;
}) {
  const rail = useChannelsRail();
  return (
    <div
      classList={{
        'pl-2': props.row.kind !== 'section' && props.row.kind !== 'label',
      }}
    >
      <Switch>
        <Match when={props.row.kind === 'section' ? props.row : undefined}>
          {(row) => <SectionHeading group={row().group} />}
        </Match>
        <Match when={props.row.kind === 'status' ? props.row : undefined}>
          {(row) => <SectionStatus group={row().group} />}
        </Match>
        <Match
          when={props.row.kind === 'reference-status' ? props.row : undefined}
        >
          {(row) => (
            <Show
              when={row().state === 'loading'}
              fallback={
                <RailListError retry={rail.retryReferencedChannels} compact />
              }
            >
              <RailListLoadingMore variant="channel" />
            </Show>
          )}
        </Match>
        <Match when={props.row.kind === 'label' ? props.row : undefined}>
          {(row) => <ChannelLabelRow label={row().label} />}
        </Match>
        <Match when={props.row.kind === 'favorite' ? props.row : undefined}>
          {(row) => (
            <ChannelFavoriteRow
              favorite={row().favorite}
              reorder={props.favoriteReorder}
            />
          )}
        </Match>
        <Match when={props.row.kind === 'conversation' ? props.row : undefined}>
          {(row) => (
            <ChannelOption
              channel={row().channel}
              rowId={row().id}
              labelId={row().labelId}
              draggable={canLabelChannel(row().channel)}
            />
          )}
        </Match>
      </Switch>
    </div>
  );
}

type SectionHandle = {
  root?: HTMLDivElement;
  virtualizer?: VirtualizerHandle;
};

function BrowseSection(props: {
  sectionKey: ChannelSectionKey;
  section: ChannelRailSectionRows;
  maxHeight: number;
  favoriteReorder: ReturnType<typeof useFavoriteReorder>;
  register: (key: ChannelSectionKey, handle: SectionHandle) => () => void;
}) {
  const rail = useChannelsRail();
  const handle: SectionHandle = {};
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const size = createElementSize(scrollRoot);
  onCleanup(props.register(props.sectionKey, handle));
  const heading = () => props.section.heading;
  const open = () => {
    const row = heading();
    return row.kind === 'label'
      ? rail.isLabelOpen(row.label.id)
      : rail.isGroupOpen(row.group);
  };
  const label = () => {
    const row = heading();
    return row.kind === 'label'
      ? row.label.name
      : t(`channelSections.${row.group}`);
  };
  const emptyMessage = () => {
    if (rail.sectionPreferences(props.sectionKey).unreadOnly)
      return t('channelSections.noUnreadConversations');
    const row = heading();
    if (row.kind === 'section') return t('channelSections.emptyFavorites');
    return row.label.rule
      ? t('channelSections.emptySmartSection')
      : t('channelSections.emptySection');
  };
  const focusIndex = () =>
    props.section.rows.findIndex((row) => row.id === rail.list.focus.key());
  const loadVisibleSections = () => {
    const current = virtualizer();
    if (!open() || !current) return;
    const first = current.findItemIndex(
      Math.max(0, current.scrollOffset - 100)
    );
    const last = current.findItemIndex(
      current.scrollOffset + current.viewportSize + 150
    );
    for (const row of props.section.rows.slice(first, last + 1)) {
      if (row.kind !== 'status') continue;
      const source = rail.sources[row.group];
      if (source.hasMore() && !source.isFetching() && !source.error())
        fireAndForget(source.loadMore(), 'channels-view');
    }
  };
  createEffect(
    on([() => props.section.rows, open, virtualizer, () => size.height], () => {
      if (!open()) return;
      const frame = requestAnimationFrame(loadVisibleSections);
      onCleanup(() => cancelAnimationFrame(frame));
    })
  );
  return (
    <ResizableRailSection
      section={props.sectionKey}
      label={label()}
      open={open()}
      maxHeight={props.maxHeight}
      itemCount={
        props.section.rows.filter(
          (row) => row.kind === 'conversation' || row.kind === 'favorite'
        ).length
      }
      rootRef={(element) => {
        handle.root = element;
      }}
      scrollRef={(element) => {
        setScrollRoot(element);
        const row = heading();
        if (row.kind === 'section') rail.registerScrollRef(row.group, element);
      }}
      header={
        <BrowseRow row={heading()} favoriteReorder={props.favoriteReorder} />
      }
    >
      <Show
        when={props.section.rows.length > 0}
        fallback={
          <p class="py-2 pr-2 pl-4 text-xs text-ink-extra-muted">
            {emptyMessage()}
          </p>
        }
      >
        <Virtualizer
          ref={(current) => {
            handle.virtualizer = current;
            setVirtualizer(current);
          }}
          data={props.section.rows}
          scrollRef={scrollRoot()}
          itemSize={CHANNEL_SECTION_ROW_HEIGHT}
          bufferSize={200}
          keepMounted={focusIndex() >= 0 ? [focusIndex()] : undefined}
          onScroll={loadVisibleSections}
        >
          {(row) => (
            <BrowseRow row={row} favoriteReorder={props.favoriteReorder} />
          )}
        </Virtualizer>
      </Show>
    </ResizableRailSection>
  );
}

function ExpandedBrowse() {
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const scrollSize = createElementSize(scrollRoot);
  const sections = createMemo(() =>
    groupChannelRailSections(rail.list.items.all())
  );
  const keys = createMemo(() => [...sections().keys()]);
  const handles = new Map<ChannelSectionKey, SectionHandle>();
  const favoriteReorder = useFavoriteReorder(
    () =>
      sections()
        .get('favorites')
        ?.rows.flatMap((row) =>
          row.kind === 'favorite' ? [row.favorite] : []
        ) ?? []
  );
  createScrollTopFade(scrollRoot);
  const register = (key: ChannelSectionKey, handle: SectionHandle) => {
    handles.set(key, handle);
    return () => {
      if (handles.get(key) === handle) handles.delete(key);
    };
  };
  onCleanup(
    rail.registerBrowseScrollHandle({
      scrollToIndex: (index, options) => {
        const row = rail.list.items.at(index);
        if (!row) return;
        for (const [key, section] of sections()) {
          const localIndex = section.rows.findIndex(
            (item) => item.id === row.id
          );
          if (section.heading.id !== row.id && localIndex < 0) continue;
          const handle = handles.get(key);
          if (!handle) return;
          if (localIndex >= 0)
            handle.virtualizer?.scrollToIndex(localIndex, options);
          const container = scrollRoot();
          if (container && handle.root) {
            const bounds = handle.root.getBoundingClientRect();
            const viewport = container.getBoundingClientRect();
            if (bounds.top < viewport.top)
              container.scrollTop += bounds.top - viewport.top;
            else if (bounds.bottom > viewport.bottom)
              container.scrollTop += bounds.bottom - viewport.bottom;
          }
          return;
        }
      },
    })
  );
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div
        ref={setScrollRoot}
        class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-(--sidebar-gutter)"
      >
        <For each={keys()}>
          {(key) => (
            <Show when={sections().get(key)}>
              {(section) => (
                <BrowseSection
                  sectionKey={key}
                  section={section()}
                  maxHeight={Math.max(
                    CHANNEL_SECTION_MIN_HEIGHT,
                    (scrollSize.height ?? 300) - 48
                  )}
                  favoriteReorder={favoriteReorder}
                  register={register}
                />
              )}
            </Show>
          )}
        </For>
      </div>
    </div>
  );
}

function ExpandedSearchResults(props: { search: ChannelRailSearch }) {
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const pagination = useChannelRailVirtualizer(() => 'search');
  createScrollTopFade(scrollRoot);
  return (
    <div
      ref={setScrollRoot}
      class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-(--sidebar-gutter)"
    >
      <Show
        when={props.search.isLoading() && props.search.results().length === 0}
      >
        <RailListLoading />
      </Show>
      <Show when={props.search.error()}>
        <RailListError retry={props.search.retry} />
      </Show>
      <Virtualizer
        ref={pagination.registerVirtualizer}
        data={props.search.results()}
        scrollRef={scrollRoot()}
        itemSize={CHANNEL_SECTION_ROW_HEIGHT}
        onScroll={pagination.loadMoreNearEnd}
      >
        {(channel) => <ChannelOption channel={channel} />}
      </Virtualizer>
      <Show
        when={
          !props.search.isLoading() &&
          !props.search.error() &&
          props.search.results().length === 0
        }
      >
        <p class="px-2 py-6 text-center text-sm text-ink-muted">
          {t('channelSections.noResults')}
        </p>
      </Show>
    </div>
  );
}

export function ExpandedChannelsRail(props: { search: ChannelRailSearch }) {
  const rail = useChannelsRail();
  const listTarget = tourTarget(CHANNELS_TOUR.list);
  return (
    <>
      <ExpandedHeader search={props.search} />
      <ChannelsLiveCallsSidebar />
      <div
        ref={(element) => {
          rail.registerRootRef(element);
          listTarget(element);
        }}
        role="tree"
        tabIndex={-1}
        aria-label={t('channelSections.conversations')}
        aria-activedescendant={
          rail.list.focus.key()
            ? domIdForRow(rail.railId, rail.list.focus.key()!)
            : undefined
        }
        class="flex min-h-0 flex-1 flex-col outline-none"
      >
        <Show when={props.search.isOpen()} fallback={<ExpandedBrowse />}>
          <ExpandedSearchResults search={props.search} />
        </Show>
      </div>
      <SlackImportSidebar />
    </>
  );
}

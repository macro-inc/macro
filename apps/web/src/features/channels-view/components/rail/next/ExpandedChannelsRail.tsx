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
import { Button, cn } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  type Accessor,
  createMemo,
  createSignal,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { canLabelChannel } from '../../../core/channel-label-eligibility';
import { ChannelsLiveCallsSidebar } from '../../../live-calls-sidebar';
import { CHANNELS_TOUR } from '../../../tour';
import type { ChannelsGroup } from '../../../types';
import { ConversationsCreateMenu } from '../../ConversationsCreateMenu';
import { ChannelFavoriteRow } from '../ChannelFavoriteRows';
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
import {
  useChannelRailSectionState,
  useChannelRailVirtualizer,
} from '../hooks/useChannelRailState';
import { ChannelLabelRow } from './ChannelLabelRows';
import { ChannelSectionHeading } from './ChannelSectionHeading';
import { ChannelSectionDropdown } from './ChannelSectionMenu';

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
    <div class="px-2">
      <Switch>
        <Match when={source().isLoading() && source().items().length === 0}>
          <RailListLoading />
        </Match>
        <Match when={source().error()}>
          <RailListError retry={source().refresh} compact />
        </Match>
        <Match when={source().isLoadingMore()}>
          <RailListLoadingMore variant="channel" />
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
          <p class="py-2 text-xs text-ink-extra-muted">
            {rail.sectionPreferences(props.group).unreadOnly
              ? t('channelSections.noUnreadConversations')
              : t('channelSections.empty')}
          </p>
        </Match>
      </Switch>
    </div>
  );
}

function BrowseRow(props: { row: ChannelRailRow }) {
  const rail = useChannelsRail();
  return (
    <div
      classList={{
        'pl-2': props.row.kind !== 'section' && props.row.kind !== 'label',
      }}
    >
      <Switch>
        <Match when={props.row.kind === 'section' ? props.row : undefined}>
          {(row) => (
            <>
              <SectionHeading group={row().group} />
              <Show
                when={
                  row().group === 'favorites' &&
                  rail.isGroupOpen('favorites') &&
                  !rail.list.items.all().some((row) => row.kind === 'favorite')
                }
              >
                <p class="py-2 pr-2 pl-4 text-xs text-ink-extra-muted">
                  {rail.sectionPreferences('favorites').unreadOnly
                    ? t('channelSections.noUnreadConversations')
                    : t('channelSections.emptyFavorites')}
                </p>
              </Show>
            </>
          )}
        </Match>
        <Match when={props.row.kind === 'status' ? props.row : undefined}>
          {(row) => <SectionStatus group={row().group} />}
        </Match>
        <Match when={props.row.kind === 'label' ? props.row : undefined}>
          {(row) => <ChannelLabelRow label={row().label} />}
        </Match>
        <Match when={props.row.kind === 'favorite' ? props.row : undefined}>
          {(row) => <ChannelFavoriteRow favorite={row().favorite} />}
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

function ExpandedBrowse() {
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const registration = useChannelRailVirtualizer(() => 'team_channels');
  const rows = createMemo(() =>
    rail.list.items.all().filter((row) => row.group !== 'direct_messages')
  );
  createScrollTopFade(scrollRoot);
  const focusIndex = () =>
    rows().findIndex((row) => row.id === rail.list.focus.key());
  const loadVisibleSections = () => {
    const handle = virtualizer();
    if (!handle) return;
    const first = handle.findItemIndex(Math.max(0, handle.scrollOffset - 100));
    const last = handle.findItemIndex(
      handle.scrollOffset + handle.viewportSize + 150
    );
    for (const row of rows().slice(first, last + 1)) {
      if (row.kind !== 'status') continue;
      const source = rail.sources[row.group];
      if (source.hasMore() && !source.isFetching())
        fireAndForget(source.loadMore(), 'channels-view');
    }
  };
  return (
    <div
      ref={(element) => {
        setScrollRoot(element);
        for (const group of ['favorites', 'team_channels', 'channels'] as const)
          rail.registerScrollRef(group, element);
      }}
      class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-(--sidebar-gutter)"
    >
      <Virtualizer
        ref={(handle) => {
          setVirtualizer(handle);
          registration.registerVirtualizer(handle);
        }}
        data={rows()}
        scrollRef={scrollRoot()}
        itemSize={34}
        bufferSize={300}
        keepMounted={focusIndex() >= 0 ? [focusIndex()] : undefined}
        onScroll={loadVisibleSections}
      >
        {(row) => <BrowseRow row={row} />}
      </Virtualizer>
    </div>
  );
}

function DirectMessages() {
  const rail = useChannelsRail();
  const { state } = useChannelRailSectionState(() => 'direct_messages');
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const pagination = useChannelRailVirtualizer(() => 'direct_messages');
  return (
    <div
      class={cn(
        'shrink-0 border-t border-edge-muted px-(--sidebar-gutter)',
        state().open && 'flex h-1/3 min-h-24 flex-col'
      )}
    >
      <SectionHeading group="direct_messages" />
      <Show when={state().open}>
        <div
          ref={(element) => {
            setScrollRoot(element);
            rail.registerScrollRef('direct_messages', element);
          }}
          class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto pl-2"
        >
          <Virtualizer
            ref={pagination.registerVirtualizer}
            data={state().items}
            scrollRef={scrollRoot()}
            itemSize={34}
            bufferSize={200}
            keepMounted={state().keepMounted}
            onScroll={pagination.loadMoreNearEnd}
          >
            {(channel) => <ChannelOption channel={channel} />}
          </Virtualizer>
          <SectionStatus group="direct_messages" />
        </div>
      </Show>
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
        itemSize={34}
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
        <Show
          when={props.search.isOpen()}
          fallback={
            <>
              <ExpandedBrowse />
              <DirectMessages />
            </>
          }
        >
          <ExpandedSearchResults search={props.search} />
        </Show>
      </div>
      <SlackImportSidebar />
    </>
  );
}

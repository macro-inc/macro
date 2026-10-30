import { SearchBar, ViewSidebar } from '@app/components/view-shell';
import { SlackImportSidebar } from '@app/features/slack-import/slack-import-sidebar';
import { t } from '@app/lib/i18n';
import { ChannelMutedIndicator } from '@channel/components/ChannelMutedIndicator';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createScrollTopFade } from '@core/util/createScrollTopFade';
import { fireAndForget } from '@core/util/fireAndForget';
import { type ChannelEntity, Entity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import {
  createDraggable,
  createDroppable,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { Button, cn, Tooltip } from '@ui';
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
import { canLabelChannel } from '../../core/channel-label-eligibility';
import { ChannelsLiveCallsSidebar } from '../../live-calls-sidebar';
import { CHANNELS_TOUR } from '../../tour';
import type { ChannelsGroup } from '../../types';
import { formatDetailedTimestamp } from '../../utils';
import { ConversationsCreateMenu } from '../ConversationsCreateMenu';
import { ChannelFavoriteRow } from './ChannelFavoriteRows';
import {
  ChannelLabelMenuItems,
  ChannelLabelRow,
  ChannelsSectionsMenu,
} from './ChannelLabelRows';
import {
  ChannelAvatar,
  ChannelCallIndicator,
  ChannelRailItemContextMenu,
  IncomingCallActions,
  isPrimaryMouseDown,
} from './ChannelRailItems';
import { ChannelSectionDropdown } from './ChannelSectionMenu';
import {
  type ChannelLabelDragData,
  type ChannelLabelDropData,
  type ChannelRailRow,
  domIdForRow,
  rowKeyForChannel,
  rowKeyForSection,
  useChannelsRail,
} from './ChannelsRailContext';
import {
  ChannelSectionHeading,
  RailListError,
  RailListLoading,
  RailListLoadingMore,
} from './ChannelsRailSection';
import {
  useChannelRailItemState,
  useChannelRailSectionState,
  useChannelRailVirtualizer,
} from './hooks/useChannelRailState';

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

/**
 * Drag a channel between labels. Registered once per Channels-section row: a
 * row is the drag source, and also a drop target that means "into this row's
 * label" (or "group these two" when the row is in no label).
 */
function createChannelLabelDnd(props: {
  channel: ChannelEntity;
  rowId: string;
  labelId: () => string | undefined;
  /** Drops are refused while the team's labels are unavailable. */
  disabled: () => boolean;
}) {
  const rail = useChannelsRail();
  const draggable = createDraggable(
    `${rail.railId}:channel-label:drag:${props.rowId}`,
    {
      dragType: 'channel-label',
      dndScope: rail.railId,
      channelId: props.channel.id,
      get labelId() {
        return rail
          .labels()
          .find(
            (label) =>
              !label.rule && label.channelIds.includes(props.channel.id)
          )?.id;
      },
      name: props.channel.name,
      iconType: 'channel',
    } satisfies ChannelLabelDragData
  );
  const droppable = createDroppable(
    `${rail.railId}:channel-label:channel:${props.rowId}`,
    {
      dragType: 'channel-label-target',
      dndScope: rail.railId,
      get target() {
        const labelId = props.labelId();
        const label = rail.labels().find((label) => label.id === labelId);
        return labelId
          ? {
              kind: label?.rule ? ('smart-tag' as const) : ('label' as const),
              labelId,
            }
          : { kind: 'channel' as const, channelId: props.channel.id };
      },
      isDropTargetDisabled: props.disabled,
    } satisfies ChannelLabelDropData
  );
  return { draggable, droppable };
}

function ChannelOption(props: {
  channel: ChannelEntity;
  /** The list row this option stands for; defaults to the channel's own row. */
  rowId?: ChannelRailRow['id'];
  /** Containing section for drag-and-drop targets. */
  labelId?: string;
  /** Make a team-channel row draggable between labels (Team channels section only). */
  draggable?: boolean;
}) {
  const rail = useChannelsRail();
  const rowId = () => props.rowId ?? rowKeyForChannel(props.channel.id);
  const item = useChannelRailItemState(() => props.channel.id, rowId);
  const timestamp = () =>
    props.channel.latestRootMessage?.createdAt ?? props.channel.updatedAt;
  // Whether a row participates in drag and drop is fixed per mount.
  const dnd = props.draggable
    ? createChannelLabelDnd({
        channel: props.channel,
        rowId: rowId(),
        labelId: () => props.labelId,
        disabled: () =>
          !rail.labelsAvailable() || !canLabelChannel(props.channel),
      })
    : undefined;

  // Selection belongs to a click, never the press that starts a drag.
  let didDrag = false;
  const [, dragActions] = useDragDropContext() ?? [];
  dragActions?.onDragStart(({ draggable }) => {
    if (
      draggable.data.dndScope === rail.railId &&
      draggable.data.channelId === props.channel.id
    )
      didDrag = true;
  });

  // A plain row highlights alone (dropping on it groups the two); a row in a
  // label is highlighted as part of its whole label by ChannelsSectionRows.
  const isGroupingTarget = () => {
    const target = rail.activeDropTarget();
    return target?.kind === 'channel' && target.channelId === props.channel.id;
  };

  return (
    <div
      ref={(element) => {
        dnd?.draggable.ref(element);
        dnd?.droppable.ref(element);
      }}
      {...(canLabelChannel(props.channel) ? dnd?.draggable.dragActivators : {})}
      onPointerDown={(event) => {
        didDrag = false;
        rail.prefetchRow(rowId(), event);
      }}
      class={cn(
        'min-w-0',
        props.draggable && 'pb-0.5',
        isGroupingTarget() &&
          'rounded-lg bg-selected ring-1 ring-inset ring-accent',
        dnd?.draggable.isActiveDraggable && 'opacity-50'
      )}
    >
      <ChannelRailItemContextMenu
        channel={props.channel}
        class="block w-full"
        extraItems={<ChannelLabelMenuItems channel={props.channel} />}
      >
        <ViewSidebar.Item
          as="div"
          ref={tourTarget(CHANNELS_TOUR.conversation)}
          id={item().domId}
          role="treeitem"
          tabIndex={-1}
          class={cn(
            'group/channel-option relative',
            !item().selected &&
              !isTouchDevice() &&
              item().focused &&
              'bg-hover text-ink'
          )}
          active={item().selected && !isTouchDevice()}
          aria-current={item().selected ? 'page' : undefined}
          onClick={(event) => {
            if (!isPrimaryMouseDown(event) || didDrag) return;
            rail.activateRow(rowId(), event);
          }}
        >
          <ViewSidebar.Icon>
            <ChannelAvatar channel={props.channel} />
          </ViewSidebar.Icon>
          <span class="min-w-0 flex-1 truncate">{props.channel.name}</span>
          <span class="flex shrink-0 items-center gap-2">
            <ChannelMutedIndicator muted={item().muted} />
            <ChannelCallIndicator
              status={item().incomingCallId ? undefined : item().callStatus}
            />
            <Show when={item().unread}>
              <span
                aria-label="Unread"
                class="size-2 shrink-0 rounded-full bg-accent"
              />
            </Show>
            <Show when={!item().incomingCallId && timestamp()}>
              {(value) => (
                <span class="relative hidden shrink-0 group-hover/channel-option:block touch:hidden">
                  <span
                    aria-hidden="true"
                    class="invisible whitespace-nowrap text-xs font-light"
                  >
                    <Entity.Timestamp
                      entity={props.channel}
                      overrideTimeStamp={value()}
                    />
                  </span>
                  <Tooltip
                    label={formatDetailedTimestamp(value())}
                    placement="top"
                    class="absolute inset-0 flex items-center"
                  >
                    <span class="whitespace-nowrap text-xs font-light text-ink-extra-muted">
                      <Entity.Timestamp
                        entity={props.channel}
                        overrideTimeStamp={value()}
                      />
                    </span>
                  </Tooltip>
                </span>
              )}
            </Show>
          </span>
          <IncomingCallActions
            callId={item().incomingCallId}
            channelId={props.channel.id}
          />
        </ViewSidebar.Item>
      </ChannelRailItemContextMenu>
    </div>
  );
}

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
        <ChannelsSectionsMenu />
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
  return (
    <ChannelSectionHeading
      id={domIdForRow(rail.railId, key())}
      title={title()}
      label={title()}
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
              <p class="px-2 py-2 text-xs text-ink-extra-muted">
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
      class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-(--sidebar-content-inset)"
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
        'shrink-0 border-t border-edge-muted px-(--sidebar-content-inset)',
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
          class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto"
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
      class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-(--sidebar-content-inset)"
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

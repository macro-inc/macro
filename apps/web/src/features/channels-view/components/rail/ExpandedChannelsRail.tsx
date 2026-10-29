import { SearchBar, ViewSidebar } from '@app/components/view-shell';
import { runCreateAction } from '@app/features/command/Launcher';
import { SlackImportSidebar } from '@app/features/slack-import/slack-import-sidebar';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { ChannelMutedIndicator } from '@channel/components/ChannelMutedIndicator';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createScrollTopFade } from '@core/util/createScrollTopFade';
import EmptyStateNoSearchMatchGraphic from '@design/empty-state-no-search-match.svg';
import { type ChannelEntity, Entity } from '@entity';
import ArrowBendUpLeftIcon from '@icon/system/regular/arrow-bend-up-left.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import ChatCircleTextIcon from '@icon/system/regular/chat-circle-text.svg';
import ChatsCircleIcon from '@icon/system/regular/chats-circle.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import MagnifyingGlassIcon from '@icon/system/regular/magnifying-glass.svg';
import SortIcon from '@icon/system/regular/sort-ascending.svg';
import XIcon from '@icon/system/regular/x.svg';
import {
  createDraggable,
  createDroppable,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import {
  cn,
  Dropdown,
  EmptyStatePanel,
  Hotkey,
  type TabOption,
  Tabs,
  Tooltip,
} from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  type Accessor,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { canLabelChannel } from '../../core/channel-label-eligibility';
import { ChannelsLiveCallsSidebar } from '../../live-calls-sidebar';
import { CHANNELS_TOUR } from '../../tour';
import type {
  ChannelListSort,
  ChannelsGroup,
  ChannelsSortGroup,
  ChannelsTab,
} from '../../types';
import { channelMentionsUser, formatDetailedTimestamp } from '../../utils';
import { ChannelsEmptyState } from '../ChannelsEmptyState';
import { ConversationsCreateMenu } from '../ConversationsCreateMenu';
import { ChannelFavoritesSection } from './ChannelFavoriteRows';
import {
  ChannelLabelMenuItems,
  ChannelLabelRow,
  ChannelsCreateMenu,
} from './ChannelLabelRows';
import {
  ChannelAvatar,
  ChannelCallIndicator,
  ChannelRailItemContextMenu,
  CONVERSATION_CARD_HEIGHT,
  ConversationCard,
  IncomingCallActions,
  isPrimaryMouseDown,
} from './ChannelRailItems';
import {
  ALL_THREADS_ROW_ID,
  type ChannelLabelDragData,
  type ChannelLabelDropData,
  type ChannelRailRow,
  type ChannelSectionRow,
  domIdForRow,
  rowKeyForChannel,
  useChannelsRail,
} from './ChannelsRailContext';
import {
  COLLAPSED_SECTION_HEIGHT,
  CollapsibleSection,
  CreateRailAction,
  RailListError,
  RailListLoading,
  RailListLoadingMore,
} from './ChannelsRailSection';
import { ChannelUnreadEmptyState } from './ChannelUnreadFilter';
import {
  CHANNEL_LIST_GROUPS,
  useChannelRailItemState,
  useChannelRailScopeState,
  useChannelRailSectionState,
  useChannelRailVirtualizer,
} from './hooks/useChannelRailState';

// Icons stand in for the labels when the rail is too narrow for them.
const CHANNEL_TABS: TabOption<ChannelsTab>[] = [
  { value: 'browse', label: 'All', icon: ChatCircleTextIcon },
  { value: 'recents', label: 'Recent', icon: ClockIcon },
];
const CHANNEL_TABS_WITH_THREADS: TabOption<ChannelsTab>[] = [
  ...CHANNEL_TABS,
  { value: 'threads', label: 'Threads', icon: ArrowBendUpLeftIcon },
];

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

type GroupConfig = {
  group: ChannelsGroup;
  label: string;
  emptyLabel: string;
  unreadEmptyLabel: string;
  createLabel: string;
  onCreate: () => void;
};

const GROUPS: GroupConfig[] = [
  {
    group: 'team_channels',
    label: 'Team channels',
    emptyLabel: 'No team channels',
    unreadEmptyLabel: 'No unread team channels',
    createLabel: 'Create channel',
    onCreate: openNewChannelModal,
  },
  {
    group: 'channels',
    label: 'Channels',
    emptyLabel: 'No channels',
    unreadEmptyLabel: 'No unread channels',
    createLabel: 'Create channel',
    onCreate: openNewChannelModal,
  },
  {
    group: 'direct_messages',
    label: 'DMs',
    emptyLabel: 'No direct messages',
    unreadEmptyLabel: 'No unread direct messages',
    createLabel: 'Start direct message',
    onCreate: () => runCreateAction('channel'),
  },
];

const CHANNEL_SORT_OPTIONS: {
  value: ChannelListSort;
  label: string;
}[] = [
  { value: 'viewed_at', label: 'Last viewed' },
  { value: 'updated_at', label: 'Last updated' },
  { value: 'created_at', label: 'Date created' },
];

function ChannelSortDropdown(props: {
  group: ChannelsSortGroup;
  label: string;
}) {
  const rail = useChannelsRail();
  const setSort = (value: string) => {
    const option = CHANNEL_SORT_OPTIONS.find((item) => item.value === value);
    if (option) rail.setSortBy(props.group, option.value);
  };

  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        aria-label={`Sort ${props.label.toLowerCase()}`}
        tooltip={`Sort ${props.label.toLowerCase()}`}
        as={ViewSidebar.Control}
        variant="ghost"
        size="icon-sm"
      >
        <SortIcon class="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-40">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={rail.sortBy(props.group)}
            onChange={setSort}
          >
            <For each={CHANNEL_SORT_OPTIONS}>
              {(option) => (
                <Dropdown.RadioItem closeOnSelect value={option.value}>
                  <span class="flex-1">{option.label}</span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

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
  /** Nest under a label heading, with the branch rail. */
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
        props.labelId !== undefined &&
          'relative pl-(--sidebar-icon-slot) before:pointer-events-none before:absolute before:inset-y-0 before:left-(--sidebar-local-rail) before:w-px before:-translate-x-1/2 before:bg-edge-muted',
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
  const selectTab = (value: ChannelsTab) => {
    if (value !== 'threads' || rail.threadsEnabled()) rail.selectTab(value);
  };

  return (
    <div class="flex shrink-0 flex-col">
      <ViewSidebar.Header
        searchLabel="Search conversations"
        searchOpen={props.search.isOpen()}
        onSearchOpenChange={(open) =>
          open ? props.search.open() : props.search.close()
        }
        search={() => (
          <SearchBar
            ref={props.search.registerInput}
            label="Search channels and direct messages"
            placeholder="Search conversations"
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
          <ViewSidebar.Title>Chat</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Primary class="flex flex-col gap-3">
        <Show when={!isTouchDevice()}>
          <ConversationsCreateMenu presentation="sidebar" />
        </Show>
        <ViewSidebar.Toolbar class={!isTouchDevice() ? 'px-0' : undefined}>
          <Tabs
            aria-label="Chat sidebar views"
            size="md"
            fullWidth={!isTouchDevice()}
            options={
              rail.threadsEnabled() ? CHANNEL_TABS_WITH_THREADS : CHANNEL_TABS
            }
            value={rail.tab()}
            onChange={selectTab}
            toggle={{
              label: 'Unread',
              icon: EyeSlashIcon,
              checked: rail.unreadOnly(),
              onChange: rail.setUnreadOnly,
            }}
          />
          <Show when={isTouchDevice()}>
            <ViewSidebar.Control
              aria-label={
                props.search.isOpen() ? 'Close search' : 'Search conversations'
              }
              aria-pressed={props.search.isOpen()}
              class={cn(props.search.isOpen() && 'bg-active text-ink')}
              onClick={() =>
                props.search.isOpen()
                  ? props.search.close()
                  : props.search.open()
              }
            >
              <MagnifyingGlassIcon class="size-3.5" />
            </ViewSidebar.Control>
          </Show>
        </ViewSidebar.Toolbar>
      </ViewSidebar.Primary>
      <Show when={isTouchDevice() && props.search.isOpen()}>
        <div class="px-(--sidebar-content-inset) pt-(--sidebar-gutter)">
          <SearchBar
            ref={props.search.registerInput}
            label="Search channels and direct messages"
            placeholder="Search conversations"
            value={props.search.query()}
            hotkey="cmd+f"
            onValueChange={props.search.setQuery}
            onEscape={() => {
              if (!props.search.query()) props.search.close();
            }}
            class="h-9 shrink-0 rounded-xl"
          />
        </div>
      </Show>
    </div>
  );
}

function ExpandedSearchResults(props: { search: ChannelRailSearch }) {
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  createScrollTopFade(scrollRoot);
  const pagination = useChannelRailVirtualizer(() => 'search');
  const query = () => props.search.query().trim();
  const focusedIndex = () => {
    const row = rail.list.focus.item();
    return row?.kind === 'conversation' && row.scope === 'search'
      ? row.localIndex
      : -1;
  };

  return (
    <Switch>
      <Match
        when={props.search.isLoading() && props.search.results().length === 0}
      >
        <RailListLoading />
      </Match>
      <Match when={props.search.error() && props.search.results().length === 0}>
        <RailListError retry={props.search.retry} />
      </Match>
      <Match when={props.search.results().length > 0}>
        <div
          ref={setScrollRoot}
          class="scrollbar-hidden size-full min-h-0 overflow-y-auto"
          aria-busy={rail.sources.search.isLoadingMore()}
        >
          <Virtualizer
            ref={pagination.registerVirtualizer}
            data={props.search.results()}
            scrollRef={scrollRoot()}
            itemSize={rail.tab() === 'recents' ? CONVERSATION_CARD_HEIGHT : 34}
            bufferSize={360}
            keepMounted={focusedIndex() >= 0 ? [focusedIndex()] : undefined}
            onScroll={pagination.loadMoreNearEnd}
          >
            {(channel) => (
              <Show
                when={rail.tab() === 'recents'}
                fallback={
                  <div class="px-4 pb-0.5">
                    <ChannelOption channel={channel} />
                  </div>
                }
              >
                <RecentConversationCard channel={channel} />
              </Show>
            )}
          </Virtualizer>
          <Show when={rail.sources.search.isLoadingMore()}>
            <RailListLoadingMore
              variant={rail.tab() === 'recents' ? 'recent' : 'channel'}
            />
          </Show>
          <Show when={props.search.isLoading()}>
            <RailListLoadingMore
              variant={rail.tab() === 'recents' ? 'recent' : 'channel'}
            />
          </Show>
        </div>
      </Match>
      <Match when={true}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateNoSearchMatchGraphic}
          title={query() ? 'No results' : 'No conversations to show'}
          description={
            query() ? (
              <span>
                No conversations match{' '}
                <span class="[overflow-wrap:anywhere]">“{query()}”</span>
              </span>
            ) : (
              'Channels and direct messages you join will appear here.'
            )
          }
          primaryAction={
            query()
              ? {
                  label: 'Clear search',
                  icon: XIcon,
                  onClick: () => props.search.setQuery(''),
                }
              : undefined
          }
        />
      </Match>
    </Switch>
  );
}

const labelRowOf = (row: ChannelSectionRow) =>
  row.kind === 'label' ? row : undefined;
const channelRowOf = (row: ChannelSectionRow) =>
  row.kind === 'conversation' ? row : undefined;

/**
 * The Team channels section body: an optional "new label" draft, then one
 * virtualized list of label headings and channels. Dropping a dragged channel
 * on the list itself, outside any row, takes it out of its label.
 */
function ChannelsSectionRows(props: {
  rows: readonly ChannelSectionRow[];
  registerVirtualizer: (handle?: VirtualizerHandle) => void;
  scrollRoot: HTMLDivElement | undefined;
  keepMounted: number[] | undefined;
  onScroll: (offset?: number) => void;
  emptyLabel: string;
  children: JSX.Element;
}) {
  const rail = useChannelsRail();
  const droppable = createDroppable(`${rail.railId}:channel-label:unlabelled`, {
    dragType: 'channel-label-target',
    dndScope: rail.railId,
    target: { kind: 'unlabelled' },
    isDropTargetDisabled: () => !rail.labelsAvailable(),
  } satisfies ChannelLabelDropData);
  const isUnlabelledTarget = () =>
    rail.activeDropTarget()?.kind === 'unlabelled';
  // Rows of the label the cursor is over form one highlighted block: the
  // heading rounds the top, the last row rounds the bottom, and the 2px row
  // gap is painted too so the block reads as one shape.
  const groupHighlight = (row: ChannelSectionRow, index: number) => {
    const target = rail.activeDropTarget();
    if (target?.kind !== 'label') return undefined;
    const labelId = row.kind === 'label' ? row.label.id : row.labelId;
    if (labelId !== target.labelId) return undefined;
    const next = props.rows[index + 1];
    const isLast =
      next === undefined ||
      (next.kind === 'label' ? next.label.id : next.labelId) !== labelId;
    return cn(
      'bg-selected',
      row.kind === 'label' && 'rounded-t-lg',
      isLast && 'rounded-b-lg'
    );
  };

  return (
    <div ref={droppable.ref} class="flex min-h-full flex-col">
      <Show
        when={props.rows.length > 0}
        fallback={
          <div class="px-2 py-2 text-xs text-ink-extra-muted">
            {props.emptyLabel}
          </div>
        }
      >
        <Virtualizer
          ref={props.registerVirtualizer}
          data={props.rows}
          scrollRef={props.scrollRoot}
          itemSize={34}
          bufferSize={240}
          keepMounted={props.keepMounted}
          onScroll={props.onScroll}
        >
          {(row, index) => (
            <div class={groupHighlight(row, index())}>
              <Switch>
                <Match when={labelRowOf(row)}>
                  {(labelRow) => <ChannelLabelRow label={labelRow().label} />}
                </Match>
                <Match when={channelRowOf(row)}>
                  {(channelRow) => (
                    <ChannelOption
                      channel={channelRow().channel}
                      labelId={channelRow().labelId}
                      rowId={rowKeyForChannel(
                        channelRow().channel.id,
                        channelRow().labelId
                      )}
                      draggable={canLabelChannel(channelRow().channel)}
                    />
                  )}
                </Match>
              </Switch>
            </div>
          )}
        </Virtualizer>
        {props.children}
      </Show>
      <div
        class={cn(
          'min-h-8 flex-1 rounded-lg px-2 py-2 text-xs text-ink-muted',
          isUnlabelledTarget() && 'bg-selected ring-1 ring-inset ring-accent'
        )}
      >
        <Show when={isUnlabelledTarget()}>Remove from label</Show>
      </div>
    </div>
  );
}

/** Register the heading only while tags are enabled, so disabling removes it. */
function ChannelHeadingDropTarget(props: { element: HTMLElement }) {
  const rail = useChannelsRail();
  const droppable = createDroppable(
    `${rail.railId}:channel-label:unlabelled-heading`,
    {
      dragType: 'channel-label-target',
      dndScope: rail.railId,
      target: { kind: 'unlabelled' },
      isDropTargetDisabled: () => !rail.labelsAvailable(),
    } satisfies ChannelLabelDropData
  );
  droppable.ref(props.element);
  return null;
}

function ExpandedGroupSection(props: {
  config: GroupConfig;
  /** The share of the column this section may claim while open. */
  maxHeight: string;
}) {
  // A conditional expression as `ref` is dropped by the Solid compiler, so
  // the target is chosen inside the callback.
  const createTarget = tourTarget(CHANNELS_TOUR.create);
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const [headerElement, setHeaderElement] = createSignal<HTMLElement>();
  const { state: section } = useChannelRailSectionState(
    () => props.config.group
  );
  const pagination = useChannelRailVirtualizer(() => props.config.group);
  const emptyLabel = () =>
    rail.unreadOnly() ? props.config.unreadEmptyLabel : props.config.emptyLabel;
  const registerScrollRef = (element: HTMLDivElement) => {
    setScrollRoot(element);
    rail.registerScrollRef(props.config.group, element);
  };

  return (
    <CollapsibleSection.Root
      open={section().open}
      sizing={section().fillAvailable ? 'fill' : 'share'}
      maxHeight={props.maxHeight}
    >
      <CollapsibleSection.Header
        focused={section().focused}
        focusWithin={section().containsFocus}
        class={cn(
          rail.channelTagsEnabled() &&
            props.config.group === 'team_channels' &&
            rail.activeDropTarget()?.kind === 'unlabelled' &&
            'bg-selected ring-1 ring-inset ring-accent'
        )}
        ref={setHeaderElement}
      >
        <Show
          when={
            rail.channelTagsEnabled() &&
            props.config.group === 'team_channels' &&
            headerElement()
          }
          keyed
        >
          {(element) => <ChannelHeadingDropTarget element={element} />}
        </Show>
        <button
          id={section().domId}
          type="button"
          role="treeitem"
          tabIndex={-1}
          class="relative flex h-full min-w-0 flex-1 items-center gap-1 rounded-xl px-2 text-left outline-none"
          aria-expanded={section().open}
          onMouseDown={(event) => {
            if (!isPrimaryMouseDown(event)) return;
            event.preventDefault();
            rail.toggleGroup(props.config.group);
          }}
        >
          <span class="min-w-0 truncate">{props.config.label}</span>
          <CaretDownIcon
            class={cn(
              'size-2.5 shrink-0 opacity-0 transition-[opacity,rotate] duration-200 motion-reduce:transition-none group-hover/sidebar-section:opacity-100',
              !section().open && '-rotate-90 opacity-100'
            )}
          />
          <Show when={section().unreadCount > 0}>
            <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-medium leading-none tabular-nums text-accent-contrast">
              {section().unreadCount}
            </span>
          </Show>
        </button>
        <div
          ref={(element) => {
            if (props.config.group === 'channels') createTarget(element);
          }}
          data-section-action=""
          class="flex items-center gap-0.5"
        >
          <ChannelSortDropdown
            group={props.config.group}
            label={props.config.label}
          />
          <Show
            when={props.config.group === 'team_channels'}
            fallback={
              <CreateRailAction
                label={props.config.createLabel}
                onClick={props.config.onCreate}
              />
            }
          >
            <ChannelsCreateMenu />
          </Show>
        </div>
      </CollapsibleSection.Header>
      <CollapsibleSection.Content
        open={section().open}
        contentRef={registerScrollRef}
        class="flex min-h-0 flex-col gap-0.5"
        activityTargetId={section().targetId}
        activityLabel={section().label}
      >
        <Switch>
          <Match
            when={
              section().source.isLoading() &&
              section().items.length === 0 &&
              (section().rows?.length ?? 0) === 0
            }
          >
            <RailListLoading />
          </Match>
          <Match
            when={
              section().source.error() &&
              section().items.length === 0 &&
              (section().rows?.length ?? 0) === 0
            }
          >
            <RailListError retry={section().source.refresh} />
          </Match>
          <Match when={rail.channelTagsEnabled() && section().rows}>
            {(rows) => (
              <ChannelsSectionRows
                rows={rows()}
                registerVirtualizer={pagination.registerVirtualizer}
                scrollRoot={scrollRoot()}
                keepMounted={section().keepMounted}
                onScroll={pagination.loadMoreNearEnd}
                emptyLabel={emptyLabel()}
              >
                <Show when={section().source.isLoadingMore()}>
                  <RailListLoadingMore variant="channel" />
                </Show>
                <Show
                  when={
                    section().source.error() &&
                    !section().source.isLoadingMore()
                  }
                >
                  <RailListError retry={section().source.refresh} compact />
                </Show>
              </ChannelsSectionRows>
            )}
          </Match>
          <Match when={section().items.length > 0}>
            <Virtualizer
              ref={pagination.registerVirtualizer}
              data={section().items}
              scrollRef={scrollRoot()}
              itemSize={34}
              bufferSize={240}
              keepMounted={section().keepMounted}
              onScroll={pagination.loadMoreNearEnd}
            >
              {(channel) => (
                <div class="pb-0.5">
                  <ChannelOption channel={channel} />
                </div>
              )}
            </Virtualizer>
            <Show when={section().source.isLoadingMore()}>
              <RailListLoadingMore variant="channel" />
            </Show>
            <Show
              when={
                section().source.error() && !section().source.isLoadingMore()
              }
            >
              <RailListError retry={section().source.refresh} compact />
            </Show>
          </Match>
          <Match when={true}>
            <div class="px-2 py-2 text-xs text-ink-extra-muted">
              {emptyLabel()}
            </div>
          </Match>
        </Switch>
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

function ExpandedBrowse() {
  const rail = useChannelsRail();
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );
  // Label headings and channels; the Unread filter leaves out labels without
  // unread channels.
  const hasItems = () =>
    rail.channelSectionRows().length > 0 ||
    rail.favorites().length > 0 ||
    CHANNEL_LIST_GROUPS.some((group) => rail.sources[group].items().length > 0);
  const sourcesSettled = () =>
    CHANNEL_LIST_GROUPS.every(
      (group) =>
        !rail.sources[group].isLoading() && !rail.sources[group].error()
    );
  // Open sections share the column evenly; the collapsed headers and the gaps
  // come off the top first.
  const sectionMaxHeight = () => {
    const total = GROUPS.length;
    const open = GROUPS.filter(({ group }) => rail.isGroupOpen(group)).length;
    if (open === 0) return '100%';
    return `calc((100% - ${total - open} * ${COLLAPSED_SECTION_HEIGHT}px - ${total - 1} * var(--sidebar-section-gap)) / ${open})`;
  };

  return (
    <Switch>
      <Match
        when={
          !forceEmptyState() &&
          rail.unreadOnly() &&
          sourcesSettled() &&
          !hasItems()
        }
      >
        <ChannelUnreadEmptyState />
      </Match>
      <Match when={forceEmptyState() || (sourcesSettled() && !hasItems())}>
        <ChannelsEmptyState scope="channels" topAligned />
      </Match>
      <Match when={true}>
        <ViewSidebar.Content class="h-full overflow-hidden">
          <ChannelFavoritesSection />
          {/* The groups split the height left after favorites between them.
              Their caps resolve against this column, not the whole sidebar,
              so favorites is never squeezed out. */}
          <div class="flex min-h-0 flex-1 flex-col gap-(--sidebar-section-gap)">
            <For each={GROUPS}>
              {(config) => (
                <ExpandedGroupSection
                  config={config}
                  maxHeight={sectionMaxHeight()}
                />
              )}
            </For>
          </div>
        </ViewSidebar.Content>
      </Match>
    </Switch>
  );
}

function RecentConversationCard(props: { channel: ChannelEntity }) {
  const rail = useChannelsRail();
  const currentUserId = useUserId();
  const item = useChannelRailItemState(() => props.channel.id);

  return (
    <ChannelRailItemContextMenu
      channel={props.channel}
      class="block w-full"
      extraItems={<ChannelLabelMenuItems channel={props.channel} />}
    >
      <ConversationCard
        id={item().domId}
        class="border-b border-edge-muted"
        channel={props.channel}
        senderId={props.channel.latestRootMessage?.senderId}
        mentionedCurrentUser={channelMentionsUser(
          props.channel,
          currentUserId()
        )}
        unread={item().unread}
        muted={item().muted}
        callStatus={item().callStatus}
        incomingCallId={item().incomingCallId}
        selected={item().selected}
        focused={item().focused}
        onActivate={(event) =>
          rail.activateRow(rowKeyForChannel(props.channel.id), event)
        }
        onPress={(event) =>
          rail.prefetchRow(rowKeyForChannel(props.channel.id), event)
        }
      />
    </ChannelRailItemContextMenu>
  );
}

function ExpandedRecents() {
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  createScrollTopFade(scrollRoot);
  const scope = useChannelRailScopeState(() => 'recents');
  const pagination = useChannelRailVirtualizer(() => 'recents');
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );

  return (
    <Switch>
      <Match
        when={
          !forceEmptyState() &&
          scope().source.isLoading() &&
          scope().items.length === 0
        }
      >
        <RailListLoading />
      </Match>
      <Match
        when={
          !forceEmptyState() &&
          scope().source.error() &&
          scope().items.length === 0
        }
      >
        <RailListError retry={scope().source.refresh} />
      </Match>
      <Match
        when={
          !forceEmptyState() && rail.unreadOnly() && scope().items.length === 0
        }
      >
        <ChannelUnreadEmptyState />
      </Match>
      <Match when={forceEmptyState() || scope().items.length === 0}>
        <ChannelsEmptyState scope="recents" topAligned />
      </Match>
      <Match when={true}>
        <div
          ref={setScrollRoot}
          class="scrollbar-hidden size-full min-h-0 overflow-y-auto"
          aria-busy={scope().source.isLoadingMore()}
        >
          <Virtualizer
            ref={pagination.registerVirtualizer}
            data={scope().items}
            scrollRef={scrollRoot()}
            itemSize={CONVERSATION_CARD_HEIGHT}
            bufferSize={360}
            keepMounted={scope().keepMounted}
            onScroll={pagination.loadMoreNearEnd}
          >
            {(channel) => <RecentConversationCard channel={channel} />}
          </Virtualizer>
          <Show when={scope().source.isLoadingMore()}>
            <RailListLoadingMore variant="recent" />
          </Show>
          <Show
            when={scope().source.error() && !scope().source.isLoadingMore()}
          >
            <RailListError retry={scope().source.refresh} compact />
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

function ExpandedThreads() {
  const rail = useChannelsRail();
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const scope = useChannelRailScopeState(() => 'threads');
  const pagination = useChannelRailVirtualizer(() => 'threads');
  const allThreadsDomId = () => domIdForRow(rail.railId, ALL_THREADS_ROW_ID);
  const allThreadsSelected = () => rail.threadsChannelId() === undefined;
  const allThreadsFocused = () => rail.list.focus.key() === ALL_THREADS_ROW_ID;
  const registerScrollRef = (element: HTMLDivElement) => {
    setScrollRoot(element);
    rail.registerScrollRef('threads', element);
  };

  return (
    <ViewSidebar.Content class="h-full overflow-hidden">
      <ViewSidebar.Nav aria-label="Thread filters" class="shrink-0">
        <ViewSidebar.Item
          as="div"
          id={allThreadsDomId()}
          role="treeitem"
          tabIndex={-1}
          class={cn(
            !allThreadsSelected() && allThreadsFocused() && 'bg-hover text-ink'
          )}
          active={allThreadsSelected()}
          aria-current={allThreadsSelected() ? 'page' : undefined}
          onClick={(event) => {
            if (!isPrimaryMouseDown(event)) return;
            rail.activateRow(ALL_THREADS_ROW_ID, event);
          }}
        >
          <ViewSidebar.Icon>
            <ChatsCircleIcon class="size-4" />
          </ViewSidebar.Icon>
          <span class="min-w-0 flex-1 truncate">All threads</span>
        </ViewSidebar.Item>
      </ViewSidebar.Nav>
      <CollapsibleSection.Root open sizing="fill">
        <CollapsibleSection.Header focused={false} focusWithin={false}>
          <span class="flex h-full min-w-0 flex-1 items-center px-2">
            <span class="min-w-0 truncate">Conversations</span>
          </span>
          <div data-section-action="" class="flex items-center gap-0.5">
            <ChannelSortDropdown group="threads" label="Conversations" />
            <Show when={isTouchDevice()}>
              <ConversationsCreateMenu />
            </Show>
          </div>
        </CollapsibleSection.Header>
        <CollapsibleSection.Content
          open
          contentRef={registerScrollRef}
          class="flex min-h-0 flex-col gap-0.5"
        >
          <Switch>
            <Match
              when={scope().source.isLoading() && scope().items.length === 0}
            >
              <RailListLoading />
            </Match>
            <Match when={scope().source.error() && scope().items.length === 0}>
              <RailListError retry={scope().source.refresh} />
            </Match>
            <Match when={scope().items.length > 0}>
              <Virtualizer
                ref={pagination.registerVirtualizer}
                data={scope().items}
                scrollRef={scrollRoot()}
                itemSize={34}
                bufferSize={240}
                keepMounted={scope().keepMounted}
                onScroll={pagination.loadMoreNearEnd}
              >
                {(channel) => (
                  <div class="pb-0.5">
                    <ChannelOption channel={channel} />
                  </div>
                )}
              </Virtualizer>
              <Show when={scope().source.isLoadingMore()}>
                <RailListLoadingMore variant="channel" />
              </Show>
              <Show
                when={scope().source.error() && !scope().source.isLoadingMore()}
              >
                <RailListError retry={scope().source.refresh} compact />
              </Show>
            </Match>
            <Match when={true}>
              <div class="px-2 py-2 text-xs text-ink-extra-muted">
                {rail.unreadOnly()
                  ? 'No unread conversations'
                  : 'No conversations'}
              </div>
            </Match>
          </Switch>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
    </ViewSidebar.Content>
  );
}

export function ExpandedChannelsRail(props: { search: ChannelRailSearch }) {
  const listTarget = tourTarget(CHANNELS_TOUR.list);
  const rail = useChannelsRail();
  const activeDescendant = () => {
    const rowId = rail.list.focus.key();
    return rowId === undefined ? undefined : domIdForRow(rail.railId, rowId);
  };

  return (
    <>
      <ExpandedHeader search={props.search} />
      <ChannelsLiveCallsSidebar />
      <div class="flex min-h-0 flex-1 flex-col">
        <div
          ref={(element) => {
            rail.registerRootRef(element);
            listTarget(element);
          }}
          role="tree"
          tabIndex={-1}
          aria-activedescendant={activeDescendant()}
          class="min-h-0 flex-1 overflow-hidden outline-none"
        >
          <Switch>
            <Match when={props.search.isOpen()}>
              <ExpandedSearchResults search={props.search} />
            </Match>
            <Match when={rail.tab() === 'browse'}>
              <ExpandedBrowse />
            </Match>
            <Match when={rail.tab() === 'recents'}>
              <ExpandedRecents />
            </Match>
            <Match when={rail.tab() === 'threads'}>
              <ExpandedThreads />
            </Match>
          </Switch>
        </div>
        {/* Bottom of the rail, like the Drive, Tasks, and CRM import cards. */}
        <SlackImportSidebar />
        <Show when={!props.search.isOpen() && rail.tab() === 'browse'}>
          <footer class="flex h-9 shrink-0 items-center justify-start gap-1 border-t border-edge-muted px-4 text-xxs text-ink-extra-muted">
            <span>Use</span>
            <Hotkey shortcut="[" theme="subtle" />
            <Hotkey shortcut="]" theme="subtle" />
            <span>to jump sections</span>
          </footer>
        </Show>
      </div>
    </>
  );
}

import { SearchBar, ViewSidebar } from '@app/components/view-shell';
import { runCreateAction } from '@app/features/command/Launcher';
import { SlackImportSidebar } from '@app/features/slack-import/slack-import-sidebar';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createScrollTopFade } from '@core/util/createScrollTopFade';
import EmptyStateNoSearchMatchGraphic from '@design/empty-state-no-search-match.svg';
import type { ChannelEntity } from '@entity';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import MagnifyingGlassIcon from '@icon/system/regular/magnifying-glass.svg';
import XIcon from '@icon/system/regular/x.svg';
import { createDroppable } from '@thisbeyond/solid-dnd';
import { cn, EmptyStatePanel, Hotkey, type TabOption, Tabs } from '@ui';
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
import type { ChannelsGroup, ChannelsTab } from '../../types';
import { ChannelsEmptyState } from '../ChannelsEmptyState';
import { ConversationsCreateMenu } from '../ConversationsCreateMenu';
import { ChannelFavoritesSection } from './ChannelFavoriteRows';
import { ChannelLabelRow, ChannelsCreateMenu } from './ChannelLabelRows';
import {
  ExpandedRecents,
  ExpandedThreads,
  RecentConversationCard,
} from './ChannelListViews';
import { ChannelOption } from './ChannelOption';
import {
  CONVERSATION_CARD_HEIGHT,
  isPrimaryMouseDown,
} from './ChannelRailItems';
import { ChannelSortDropdown } from './ChannelSortDropdown';
import {
  type ChannelLabelDropData,
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
import {
  CHANNEL_LIST_GROUPS,
  useChannelRailSectionState,
  useChannelRailVirtualizer,
} from './hooks/useChannelRailState';

const CHANNEL_TABS: TabOption<ChannelsTab>[] = [
  { value: 'browse', label: 'All' },
  { value: 'recents', label: 'Recent' },
];
const CHANNEL_TABS_WITH_THREADS: TabOption<ChannelsTab>[] = [
  ...CHANNEL_TABS,
  { value: 'threads', label: 'Threads' },
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
  createLabel: string;
  onCreate: () => void;
};

const GROUPS: GroupConfig[] = [
  {
    group: 'team_channels',
    label: 'Team channels',
    emptyLabel: 'No team channels',
    createLabel: 'Create channel',
    onCreate: openNewChannelModal,
  },
  {
    group: 'channels',
    label: 'Channels',
    emptyLabel: 'No channels',
    createLabel: 'Create channel',
    onCreate: openNewChannelModal,
  },
  {
    group: 'direct_messages',
    label: 'DMs',
    emptyLabel: 'No direct messages',
    createLabel: 'Start direct message',
    onCreate: () => runCreateAction('channel'),
  },
];

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
            fullWidth={!isTouchDevice()}
            options={
              rail.threadsEnabled() ? CHANNEL_TABS_WITH_THREADS : CHANNEL_TABS
            }
            value={rail.tab()}
            onChange={selectTab}
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
                emptyLabel={props.config.emptyLabel}
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
              {props.config.emptyLabel}
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
  const hasItems = () =>
    rail.labels().length > 0 ||
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

import {
  createListController,
  useListInteractions,
} from '@app/components/list';
import {
  CollapsibleSection,
  SearchBar,
  useViewControlHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import { CreateMenuItem } from '@app/components/view-shell/CreateMenuItem';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { toEntityActionListState } from '@app/features/next-soup/actions';
import { SidebarRoutineSuggestions } from '@app/features/routine-suggestions/routine-suggestions';
import { MaybeSoupEntityActionDrawerManager } from '@app/features/soup';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { enableAgentUpdates } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { unreadFilterFn } from '@entity/utils/filter';
import RoutineIcon from '@icon/system/regular/clock-clockwise.svg';
import CodeIcon from '@icon/system/regular/code.svg';
import MagnifyingGlassIcon from '@icon/system/regular/magnifying-glass.svg';
import PlugIcon from '@icon/system/regular/plugs-connected.svg';
import AgentIcon from '@icon/system/regular/sparkle.svg';
import { Key } from '@solid-primitives/keyed';
import { makePersisted } from '@solid-primitives/storage';
import { cn, Dropdown } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { createEffect, createSignal, createUniqueId, Show } from 'solid-js';
import type { AgentKind } from '../core/agent-kind';
import {
  activeFilterCount,
  type ConversationFilters,
  type ConversationGrouping,
  conversationFacts,
  conversationMatchesFilters,
  groupConversations,
} from '../core/conversation-filters';
import { compactAge } from '../core/format-age';
import type { AgentsMode } from '../core/mode';
import { selectOpenPullRequests } from '../core/open-pull-requests';
import type { AgentsPage } from '../core/pages';
import {
  type AgentConversationEntity,
  conversationTimestamp,
} from '../core/recent-conversations';
import { AGENTS_TOUR } from '../tour';
import { AgentSessionListItem } from '../views/AgentSessionListItem';
import { ConversationContextMenu } from '../views/shared/conversation-context-menu/conversation-context-menu';
import { AgentSessionListSkeleton } from './AgentSessionListSkeleton';
import {
  ConversationListControls,
  type ConversationListControlsProps,
} from './ConversationListControls';

/** Rows the filtered list should fill before paging stops waiting for a scroll. */
const FILTERED_PAGE_FILL = 20;

/** Rows from the end of the list at which moving down loads the next page. */
const LOAD_MORE_DISTANCE = 3;
export type AgentsSidebarProps = Omit<
  ConversationListControlsProps,
  'filters' | 'grouping'
> & {
  /** Only conversations matching these are listed. */
  filters: ConversationFilters;
  grouping: ConversationGrouping;
  activePage: AgentsPage | undefined;
  onOpenPage: (page: AgentsPage) => void;
  onCreateAgent: (kind: AgentKind) => void;
  onCreateRoutine: () => void;
  modeForConversation: (conversation: AgentConversationEntity) => AgentsMode;
  activeConversationId: string | undefined;
  search: string;
  conversations: AgentConversationEntity[];
  archived: AgentConversationEntity[];
  loading: boolean;
  error: boolean;
  hasNextPage: boolean;
  loadingNextPage: boolean;
  onSearchChange: (search: string) => void;
  onOpenConversation: (
    conversation: AgentConversationEntity,
    newSplit: boolean
  ) => void;
  onRetry: () => void;
  onLoadMore: () => void;
};

/** Legacy Home sections keep independent row keys for keyboard focus. */
type ConversationRow = {
  key: string;
  conversation: AgentConversationEntity;
};

type ConversationSection = 'pull-request' | 'conversation' | 'archived';
function Row(props: {
  id: string;
  conversation: AgentConversationEntity;
  mode: AgentsMode;
  active: boolean;
  focused: boolean;
  onOpen: (event: MouseEvent) => void;
}) {
  const title = () => props.conversation.name || 'Untitled chat';
  return (
    <Show
      when={props.conversation.type === 'agent_session' && props.conversation}
      fallback={
        <ViewSidebar.Item
          id={props.id}
          active={props.active}
          title={title()}
          data-kind="chat"
          onClick={props.onOpen}
          class={cn(
            'pl-3',
            props.focused && !props.active && 'not-touch:bg-hover text-ink'
          )}
        >
          <span class="min-w-0 flex-1 truncate">{title()}</span>
          <span class="shrink-0 text-xs text-ink-extra-muted tabular-nums">
            {compactAge(conversationTimestamp(props.conversation))}
          </span>
        </ViewSidebar.Item>
      }
    >
      {(session) => (
        <AgentSessionListItem
          domId={props.id}
          entity={session()}
          surface="agents"
          unread={unreadFilterFn(session())}
          mode={props.mode}
          active={props.active}
          focused={props.focused}
          onOpen={props.onOpen}
        />
      )}
    </Show>
  );
}

export function AgentsSidebar(props: AgentsSidebarProps) {
  const panel = useSplitPanelOrThrow();
  const userId = useUserId();
  const agentUpdates = useFeatureFlag(enableAgentUpdates);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [openPullRequestsOpen, setOpenPullRequestsOpen] = createSignal(true);
  const [conversationsOpen, setConversationsOpen] = createSignal(true);
  const [archivedOpen, setArchivedOpen] = makePersisted(createSignal(false), {
    name: 'agents-archived-open',
  });
  let searchInput: HTMLInputElement | undefined;
  const factsOf = (conversation: AgentConversationEntity) =>
    conversationFacts(
      conversation,
      props.modeForConversation(conversation),
      unreadFilterFn(conversation)
    );
  const matching = (conversations: AgentConversationEntity[]) =>
    conversations.filter((conversation) =>
      conversationMatchesFilters(factsOf(conversation), props.filters)
    );
  // Pages can overlap as conversations move up the list, so one can arrive
  // twice, even in two states; it lists once, as the last copy received.
  const unique = (conversations: AgentConversationEntity[]) => [
    ...new Map(
      conversations.map((conversation) => [conversation.id, conversation])
    ).values(),
  ];
  const conversations = () => matching(unique(props.conversations));
  const openPullRequests = () =>
    selectOpenPullRequests(
      unique(props.conversations),
      userId(),
      props.modeForConversation
    );
  const archived = () => matching(unique(props.archived));
  const groups = () =>
    groupConversations(conversations(), factsOf, props.grouping);
  const filtering = () => activeFilterCount(props.filters) > 0;
  const rowsOf = (
    section: ConversationSection,
    conversations: AgentConversationEntity[]
  ): ConversationRow[] =>
    conversations.map((conversation) => ({
      key: `${section}:${conversation.id}`,
      conversation,
    }));
  // The rows on screen, in screen order: a collapsed section has none.
  const visibleRows = () => [
    ...(agentUpdates().enabled && openPullRequestsOpen()
      ? rowsOf('pull-request', openPullRequests())
      : []),
    ...(conversationsOpen()
      ? groups().flatMap((group) => rowsOf('conversation', group.items))
      : []),
    ...(archivedOpen() ? rowsOf('archived', archived()) : []),
  ];
  const list = createListController<ConversationRow, { newSplit: boolean }>({
    items: visibleRows,
    getKey: (row) => row.key,
    isSelectable: () => false,
    onActivate: ({ item, metadata }) =>
      props.onOpenConversation(item.conversation, metadata?.newSplit === true),
  });
  const actionList = toEntityActionListState({
    controller: list,
    getEntity: (row) => row.conversation,
  });
  const listId = createUniqueId();
  const rowDomId = (key: string) => `${listId}-${key}`;
  // The row whose button holds DOM focus, as Tab leaves it.
  const rowKeyWithFocus = () => {
    const id = document.activeElement?.id;
    const prefix = `${listId}-`;
    return id?.startsWith(prefix) ? id.slice(prefix.length) : undefined;
  };
  let sidebar: HTMLElement | undefined;
  let listRoot: HTMLDivElement | undefined;

  // The conversation beside the sidebar shares its split's keys, so the list
  // answers only while the keyboard is in this sidebar.
  useListInteractions({
    controller: list,
    scopeId: panel.splitHotkeyScope,
    scrollHandle: () => ({
      scrollToIndex: (index) => {
        const row = list.items.at(index);
        if (!row) return;
        document
          .getElementById(rowDomId(row.key))
          ?.scrollIntoView({ block: 'nearest' });
      },
    }),
    enabled: () =>
      panel.isPanelActive() &&
      Boolean(sidebar?.contains(document.activeElement)),
    navigation: {
      // A row tabbed to is where the keyboard is, so j and k move from it.
      onBeforeMove: () => {
        const key = rowKeyWithFocus();
        if (key !== undefined) list.focus.set(key, { reason: 'keyboard' });
        return true;
      },
      onNavigate: (event) => {
        listRoot?.focus({ preventScroll: true });
        if (event.kind !== 'move' || event.direction !== 1 || !event.result)
          return;
        if (!props.hasNextPage || props.loadingNextPage) return;
        if (list.items.count() - event.result.index - 1 > LOAD_MORE_DISTANCE)
          return;
        props.onLoadMore();
      },
    },
    activation: {
      // A focused button or link, such as a row's pull request, answers Enter itself.
      shouldHandleKeyEvent: (event) =>
        !(
          event?.target instanceof Element &&
          event.target.closest('button, a[href]')
        ),
      createMetadata: (intent) => ({ newSplit: intent === 'alternate' }),
      alternateDescription: 'Open in new split',
    },
  });
  const total = () => conversations().length + archived().length;
  // Filters apply to one mixed query, so a short filtered list never scrolls
  // far enough to ask for more; keep paging until it fills.
  createEffect(() => {
    if (
      total() < FILTERED_PAGE_FILL &&
      props.hasNextPage &&
      !props.loading &&
      !props.loadingNextPage &&
      !props.error
    )
      props.onLoadMore();
  });
  // Both lists page through one query, so either reaching its end loads more.
  const loadMoreNearEnd = (event: Event & { currentTarget: HTMLElement }) => {
    const list = event.currentTarget;
    if (!props.hasNextPage || props.loadingNextPage) return;
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 200) {
      props.onLoadMore();
    }
  };
  const rows = (
    section: ConversationSection,
    conversations: () => AgentConversationEntity[]
  ) => (
    <Key each={rowsOf(section, conversations())} by="key">
      {(row) => (
        <ConversationContextMenu
          conversation={row().conversation}
          focusKey={row().key}
          list={actionList}
        >
          <Row
            id={rowDomId(row().key)}
            conversation={row().conversation}
            mode={props.modeForConversation(row().conversation)}
            active={props.activeConversationId === row().conversation.id}
            focused={list.focus.isFocused(row().key)}
            onOpen={(event) =>
              list.activate.key(row().key, {
                reason: 'pointer',
                metadata: { newSplit: event.shiftKey },
              })
            }
          />
        </ConversationContextMenu>
      )}
    </Key>
  );
  const focusedRowId = () => {
    const key = list.focus.key();
    return key === undefined ? undefined : rowDomId(String(key));
  };

  const openSearch = () => {
    setConversationsOpen(true);
    setSearchOpen(true);
    queueMicrotask(() => searchInput?.focus());
  };
  const closeSearch = () => {
    props.onSearchChange('');
    setSearchOpen(false);
  };

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search agent chats',
      condition: () => props.activePage !== 'routines',
      run: () => {
        openSearch();
        return true;
      },
    },
  });

  return (
    <MaybeSoupEntityActionDrawerManager>
      <ViewSidebar.Root
        reorderId="agents"
        ref={sidebar}
        aria-label="Agents navigation"
      >
        <ViewSidebar.Header
          searchLabel="Search conversations"
          searchOpen={searchOpen() || props.search.trim().length > 0}
          onSearchOpenChange={(open) => (open ? openSearch() : closeSearch())}
          search={() => (
            <ViewSidebar.Search
              ref={(element) => (searchInput = element)}
              label="Search conversations"
              value={props.search}
              onValueChange={props.onSearchChange}
              focusResults={() => listRoot?.focus({ preventScroll: true })}
              hasResults={() => list.items.count() > 0}
            />
          )}
        >
          <div class="flex min-w-0 items-center gap-1">
            <ViewSidebar.CloseButton />
            <ViewSidebar.Title>Agents</ViewSidebar.Title>
          </div>
        </ViewSidebar.Header>

        <Show when={!isTouchDevice()}>
          <ViewSidebar.Primary>
            <AgentCreateMenu
              onCreate={props.onCreateAgent}
              onRoutine={props.onCreateRoutine}
              onConversation={() => props.onOpenPage('new')}
            />
          </ViewSidebar.Primary>
        </Show>

        <ViewSidebar.Content
          ref={listRoot}
          role="group"
          aria-label="Conversations"
          tabIndex={isTouchDevice() ? undefined : -1}
          aria-activedescendant={focusedRowId()}
          class="gap-2 overflow-hidden pt-2 outline-none"
        >
          <SidebarRoutineSuggestions surface="agents" />
          <Show when={!isTouchDevice()}>
            <ViewSidebar.Section
              id="tools"
              label={t('viewMenus.agentViews')}
              headerless
            >
              <ViewSidebar.Nav aria-label="Agent tools">
                <ViewSidebar.Item
                  active={props.activePage === 'agents'}
                  onClick={() => props.onOpenPage('agents')}
                  ref={tourTarget(AGENTS_TOUR.rosterNav)}
                >
                  <ViewSidebar.Icon>
                    <AgentIcon />
                  </ViewSidebar.Icon>
                  <span>Agents</span>
                </ViewSidebar.Item>
                <ViewSidebar.Item
                  active={props.activePage === 'routines'}
                  onClick={() => props.onOpenPage('routines')}
                >
                  <ViewSidebar.Icon>
                    <RoutineIcon />
                  </ViewSidebar.Icon>
                  <span>Routines</span>
                </ViewSidebar.Item>
                <ViewSidebar.Item
                  active={props.activePage === 'connections'}
                  onClick={() => props.onOpenPage('connections')}
                >
                  <ViewSidebar.Icon>
                    <PlugIcon />
                  </ViewSidebar.Icon>
                  <span>Connections</span>
                </ViewSidebar.Item>
              </ViewSidebar.Nav>
            </ViewSidebar.Section>
          </Show>
          <Show when={agentUpdates().enabled && openPullRequests().length > 0}>
            <CollapsibleSection.Root
              sectionId="open-pull-requests"
              sectionLabel="Open PRs"
              open={openPullRequestsOpen()}
              onOpenChange={setOpenPullRequestsOpen}
              class={cn(
                'flex min-h-0 flex-col',
                openPullRequestsOpen() ? 'max-h-[40%]' : 'shrink-0'
              )}
            >
              <CollapsibleSection.Header>
                <CollapsibleSection.Trigger>
                  <span class="min-w-0 truncate">Open PRs</span>
                  <span class="text-ink-extra-muted tabular-nums">
                    {openPullRequests().length}
                  </span>
                  <CollapsibleSection.Indicator />
                </CollapsibleSection.Trigger>
              </CollapsibleSection.Header>
              <CollapsibleSection.Content class="flex min-h-0 flex-col">
                <ViewSidebar.Nav
                  class="min-h-0 shrink overflow-auto"
                  aria-label="Open pull requests"
                >
                  {rows('pull-request', openPullRequests)}
                </ViewSidebar.Nav>
              </CollapsibleSection.Content>
            </CollapsibleSection.Root>
          </Show>
          <CollapsibleSection.Root
            sectionId="conversations"
            sectionLabel="Conversations"
            open={conversationsOpen()}
            onOpenChange={setConversationsOpen}
            class={cn(
              'flex min-h-0 flex-col',
              conversationsOpen() ? 'flex-1' : 'shrink-0'
            )}
          >
            <CollapsibleSection.Header>
              <CollapsibleSection.Trigger class="flex-1">
                <span class="min-w-0 truncate">Conversations</span>
                <CollapsibleSection.Indicator />
              </CollapsibleSection.Trigger>
              <ConversationListControls
                filters={props.filters}
                grouping={props.grouping}
                onFilterChange={props.onFilterChange}
                onClearFilters={props.onClearFilters}
                onGroupingChange={props.onGroupingChange}
                showUnlistedRuns={props.showUnlistedRuns}
                onShowUnlistedRunsChange={props.onShowUnlistedRunsChange}
              />
              <Show when={isTouchDevice()}>
                <CollapsibleSection.Action
                  aria-label="Search conversations"
                  aria-pressed={searchOpen()}
                  class={cn(searchOpen() && 'bg-active text-ink')}
                  onClick={() => (searchOpen() ? closeSearch() : openSearch())}
                >
                  <MagnifyingGlassIcon class="size-3.5" />
                </CollapsibleSection.Action>
              </Show>
            </CollapsibleSection.Header>
            <CollapsibleSection.Content class="flex min-h-0 flex-1 flex-col gap-1">
              <Show when={isTouchDevice() && searchOpen()}>
                <SearchBar
                  ref={searchInput}
                  placeholder="Search conversations"
                  label="Search conversations"
                  value={props.search}
                  onValueChange={props.onSearchChange}
                  onEscape={() => {
                    if (!props.search) closeSearch();
                  }}
                  class="h-9 shrink-0 rounded-xl"
                />
              </Show>
              <ViewSidebar.Nav
                class="min-h-0 flex-1 shrink overflow-auto"
                aria-label="Recent conversations"
                aria-busy={props.loading || props.loadingNextPage}
                onScroll={loadMoreNearEnd}
              >
                <Key each={groups()} by="id">
                  {(group) => (
                    <>
                      <Show when={group().label}>
                        {(label) => (
                          <h3 class="flex shrink-0 items-center gap-1.5 px-(--sidebar-item-inset) pt-2 pb-1 text-xs font-medium text-ink-muted">
                            {label()}
                            <Show when={group().counted}>
                              <span class="text-ink-extra-muted tabular-nums">
                                {group().items.length}
                              </span>
                            </Show>
                          </h3>
                        )}
                      </Show>
                      {rows('conversation', () => group().items)}
                    </>
                  )}
                </Key>
                <Show when={props.loading && total() === 0}>
                  <AgentSessionListSkeleton />
                </Show>
                <Show when={props.error}>
                  <ViewSidebar.Item onClick={props.onRetry}>
                    <ViewSidebar.Icon />
                    <span class="truncate">Retry loading</span>
                  </ViewSidebar.Item>
                </Show>
                <Show when={!props.loading && !props.error && total() === 0}>
                  <p class="px-(--sidebar-item-inset) py-2 text-xs text-ink-muted">
                    {props.search.trim()
                      ? `No results for "${props.search.trim()}"`
                      : filtering()
                        ? 'No conversations match these filters.'
                        : 'No conversations yet.'}
                  </p>
                  <Show when={filtering()}>
                    <ViewSidebar.Item onClick={props.onClearFilters}>
                      <ViewSidebar.Icon />
                      <span class="truncate">Clear filters</span>
                    </ViewSidebar.Item>
                  </Show>
                </Show>
                <Show when={props.loadingNextPage}>
                  <AgentSessionListSkeleton loadingMore />
                </Show>
              </ViewSidebar.Nav>
            </CollapsibleSection.Content>
          </CollapsibleSection.Root>
          <Show when={archived().length}>
            <CollapsibleSection.Root
              sectionId="archived"
              sectionLabel="Archived"
              open={archivedOpen()}
              onOpenChange={setArchivedOpen}
              as="section"
              aria-label="Archived conversations"
              class={cn(
                'mt-auto flex min-h-0 flex-col border-t border-edge-muted pt-2',
                archivedOpen() ? 'basis-1/4' : 'shrink-0'
              )}
            >
              <CollapsibleSection.Header>
                <CollapsibleSection.Trigger>
                  <span class="min-w-0 truncate">Archived</span>
                  <CollapsibleSection.Indicator />
                </CollapsibleSection.Trigger>
              </CollapsibleSection.Header>
              <CollapsibleSection.Content class="flex min-h-0 flex-1 flex-col">
                <ViewSidebar.Nav
                  class="min-h-0 flex-1 shrink overflow-auto"
                  onScroll={loadMoreNearEnd}
                >
                  {rows('archived', archived)}
                </ViewSidebar.Nav>
              </CollapsibleSection.Content>
            </CollapsibleSection.Root>
          </Show>
        </ViewSidebar.Content>
      </ViewSidebar.Root>
    </MaybeSoupEntityActionDrawerManager>
  );
}

export function AgentCreateMenu(props: {
  onCreate: (kind: AgentKind) => void;
  onRoutine: () => void;
  onConversation: () => void;
}) {
  // Kobalte returns focus to the trigger after the menu closes, which would
  // take it back from the composer or form the choice opens.
  let chosen: (() => void) | undefined;
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        as={ViewCreateButton}
        presentation="sidebar"
        menu
        aria-label="New conversation or agent"
      />
      <Dropdown.Content
        class="w-80 max-w-[calc(100vw-2rem)]"
        onCloseAutoFocus={(event) => {
          if (!chosen) return;
          event.preventDefault();
          queueMicrotask(chosen);
          chosen = undefined;
        }}
      >
        <Dropdown.Group>
          <CreateMenuItem
            icon={AgentIcon}
            title={t('create.conversationLabel')}
            description={t('create.guideConversation')}
            onSelect={() => {
              chosen = props.onConversation;
            }}
          />
          <CreateMenuItem
            icon={AgentIcon}
            title={t('create.workAgentLabel')}
            description={t('create.guideWorkAgent')}
            onSelect={() => {
              chosen = () => props.onCreate('agent');
            }}
          />
          <CreateMenuItem
            icon={CodeIcon}
            title={t('create.codingAgentLabel')}
            description={t('create.guideCodingAgent')}
            onSelect={() => {
              chosen = () => props.onCreate('coder');
            }}
          />
          <CreateMenuItem
            icon={RoutineIcon}
            title={t('create.routineLabel')}
            description={t('create.guideRoutine')}
            onSelect={() => {
              chosen = props.onRoutine;
            }}
          />
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

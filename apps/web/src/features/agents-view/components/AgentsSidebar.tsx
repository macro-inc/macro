import { createListController } from '@app/components/list';
import {
  CollapsibleSection,
  SearchBar,
  useViewControlHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import { SidebarCreateButton } from '@app/components/view-shell/SidebarCreateButton';
import { changeSessionArchiveState } from '@app/features/block-agent/queries/change-session-archive-state';
import {
  type EntityActionListState,
  type EntityActionViewContext,
  toEntityActionListState,
} from '@app/features/next-soup/actions';
import {
  MaybeSoupEntityActionDrawerManager,
  SoupEntityContextMenu,
} from '@app/features/soup';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { MenuItem } from '@core/component/ContextMenu';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { unreadFilterFn } from '@entity/utils/filter';
import ChatIcon from '@phosphor/chat-circle.svg';
import RoutineIcon from '@phosphor/clock-clockwise.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlugIcon from '@phosphor/plugs-connected.svg';
import AgentIcon from '@phosphor/sparkle.svg';
import TrayIcon from '@phosphor/tray.svg';
import { Key } from '@solid-primitives/keyed';
import { cn, Tabs } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { createEffect, createSignal, type JSX, Show } from 'solid-js';
import { compactAge } from '../core/format-age';
import { type AgentsMode, agentsModeLabel } from '../core/mode';
import type { AgentsPage } from '../core/pages';
import {
  type AgentConversationEntity,
  conversationTimestamp,
} from '../core/recent-conversations';
import { AGENTS_TOUR } from '../tour';
import { AgentSessionListItem } from '../views/AgentSessionListItem';
import { AgentSessionListSkeleton } from './AgentSessionListSkeleton';

/** Rows a mode should fill before paging stops waiting for a scroll. */
const MODE_PAGE_FILL = 20;

const AGENTS_ACTION_VIEW_CONTEXT: EntityActionViewContext = {
  supportsMarkDone: false,
  supportsOpenInNewSplit: true,
  senderBucket: undefined,
};

export type AgentsSidebarProps = {
  /** Only conversations of this mode are listed. */
  mode: AgentsMode;
  onModeChange: (mode: AgentsMode) => void;
  activePage: AgentsPage | undefined;
  onOpenPage: (page: AgentsPage) => void;
  modeForConversation: (conversation: AgentConversationEntity) => AgentsMode;
  activeConversationId: string | undefined;
  search: string;
  conversations: AgentConversationEntity[];
  archived: AgentConversationEntity[];
  loading: boolean;
  error: boolean;
  hasNextPage: boolean;
  loadingNextPage: boolean;
  onNewConversation: () => void;
  onSearchChange: (search: string) => void;
  onOpenConversation: (
    conversation: AgentConversationEntity,
    event?: MouseEvent
  ) => void;
  onRetry: () => void;
  onLoadMore: () => void;
};

function ConversationContextMenu(props: {
  conversation: AgentConversationEntity;
  list: EntityActionListState;
  children: JSX.Element;
}) {
  const userId = useUserId();
  const setArchived = async () => {
    if (props.conversation.type !== 'agent_session') return;
    await changeSessionArchiveState(
      props.conversation.id,
      !props.conversation.isArchived
    );
  };

  return (
    <SoupEntityContextMenu
      entity={props.conversation}
      list={props.list}
      selectedEntities={() => []}
      viewContext={AGENTS_ACTION_VIEW_CONTEXT}
      as="div"
      // The nav is a fixed-height flex column, so the trigger's default
      // `h-full` would split that height between the rows; keep rows content-sized.
      class="block h-auto w-full shrink-0"
      extraItems={
        props.conversation.type === 'agent_session' &&
        props.conversation.ownerId === userId() ? (
          <MenuItem
            icon={TrayIcon}
            text={props.conversation.isArchived ? 'Unarchive' : 'Archive'}
            onClick={setArchived}
          />
        ) : undefined
      }
      onOpenChange={(open) => {
        if (!open) return;
        props.list.focus.set(props.conversation.id);
      }}
    >
      {props.children}
    </SoupEntityContextMenu>
  );
}

function Row(props: {
  conversation: AgentConversationEntity;
  mode: AgentsMode;
  active: boolean;
  onOpen: (event: MouseEvent) => void;
}) {
  const title = () => props.conversation.name || 'Untitled chat';
  return (
    <Show
      when={props.conversation.type === 'agent_session' && props.conversation}
      fallback={
        <ViewSidebar.Item
          active={props.active}
          title={title()}
          data-kind="chat"
          onClick={props.onOpen}
        >
          <ViewSidebar.Icon>
            <ChatIcon />
          </ViewSidebar.Icon>
          <span class="min-w-0 flex-1 truncate">{title()}</span>
          <span class="shrink-0 text-xs text-ink-extra-muted tabular-nums">
            {compactAge(conversationTimestamp(props.conversation))}
          </span>
        </ViewSidebar.Item>
      }
    >
      {(session) => (
        <AgentSessionListItem
          entity={session()}
          surface="agents"
          unread={unreadFilterFn(session())}
          mode={props.mode}
          active={props.active}
          onOpen={props.onOpen}
        />
      )}
    </Show>
  );
}

export function AgentsSidebar(props: AgentsSidebarProps) {
  const panel = useSplitPanelOrThrow();
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [conversationsOpen, setConversationsOpen] = createSignal(true);
  let searchInput: HTMLInputElement | undefined;
  const inMode = (conversations: AgentConversationEntity[]) =>
    conversations.filter(
      (conversation) => props.modeForConversation(conversation) === props.mode
    );
  const conversations = () => inMode(props.conversations);
  const archived = () => inMode(props.archived);
  const actionController = createListController({
    items: () => [...conversations(), ...archived()],
    getKey: (conversation) => conversation.id,
    isSelectable: () => false,
  });
  const actionList = toEntityActionListState({
    controller: actionController,
    getEntity: (conversation) => conversation,
  });
  const total = () => conversations().length + archived().length;
  // Both modes page through one mixed query, so a short filtered list never
  // scrolls far enough to ask for more; keep paging until it fills.
  createEffect(() => {
    if (
      total() < MODE_PAGE_FILL &&
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
  const rows = (conversations: () => AgentConversationEntity[]) => (
    <Key each={conversations()} by="id">
      {(conversation) => (
        <ConversationContextMenu
          conversation={conversation()}
          list={actionList}
        >
          <Row
            conversation={conversation()}
            mode={props.modeForConversation(conversation())}
            active={props.activeConversationId === conversation().id}
            onOpen={(event) => props.onOpenConversation(conversation(), event)}
          />
        </ConversationContextMenu>
      )}
    </Key>
  );

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
      <ViewSidebar.Root aria-label="Agents navigation">
        <Show when={!isTouchDevice()}>
          <ViewSidebar.Header>
            <div class="flex min-w-0 items-center gap-1">
              <ViewSidebar.CloseButton />
              <ViewSidebar.Title>Agents</ViewSidebar.Title>
            </div>
          </ViewSidebar.Header>
        </Show>

        <div
          ref={tourTarget(AGENTS_TOUR.modeSwitch)}
          class="px-(--sidebar-gutter) pt-1 touch:pt-0"
        >
          <Tabs
            aria-label="Agents mode"
            fullWidth
            list={(['chat', 'code'] as const).map((mode) => ({
              value: mode,
              label: agentsModeLabel(mode),
            }))}
            value={props.mode}
            onChange={(value) =>
              props.onModeChange(value === 'code' ? 'code' : 'chat')
            }
          />
        </div>

        <Show when={!isTouchDevice()}>
          <div class="px-(--sidebar-gutter) pt-2">
            <SidebarCreateButton
              label="New conversation"
              onCreate={props.onNewConversation}
              ref={tourTarget(AGENTS_TOUR.newChat)}
            />
          </div>
        </Show>

        <ViewSidebar.Content class="gap-2 overflow-hidden pt-2">
          <Show when={!isTouchDevice()}>
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
          </Show>
          <CollapsibleSection.Root
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
              <CollapsibleSection.Action
                label="Search conversations"
                aria-pressed={searchOpen()}
                class={cn(searchOpen() && 'bg-active text-ink')}
                onClick={() => (searchOpen() ? closeSearch() : openSearch())}
              >
                <MagnifyingGlassIcon class="size-3.5" />
              </CollapsibleSection.Action>
            </CollapsibleSection.Header>
            <CollapsibleSection.Content class="flex min-h-0 flex-1 flex-col gap-1">
              <Show when={searchOpen()}>
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
                {rows(conversations)}
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
                      : props.mode === 'code'
                        ? 'No coding conversations yet.'
                        : 'No conversations yet.'}
                  </p>
                </Show>
                <Show when={props.loadingNextPage}>
                  <AgentSessionListSkeleton loadingMore />
                </Show>
              </ViewSidebar.Nav>
            </CollapsibleSection.Content>
          </CollapsibleSection.Root>
          <Show when={archived().length}>
            <section
              aria-label="Archived conversations"
              class="mt-auto flex min-h-0 shrink-0 basis-1/4 flex-col border-t border-edge-muted pt-2"
            >
              <ViewSidebar.Toolbar class="shrink-0">
                <h3 class="text-xs font-medium text-ink-muted">Archived</h3>
                <span class="text-xs text-ink-extra-muted tabular-nums">
                  {archived().length}
                </span>
              </ViewSidebar.Toolbar>
              <ViewSidebar.Nav
                class="min-h-0 flex-1 shrink overflow-auto"
                onScroll={loadMoreNearEnd}
              >
                {rows(archived)}
              </ViewSidebar.Nav>
            </section>
          </Show>
        </ViewSidebar.Content>
      </ViewSidebar.Root>
    </MaybeSoupEntityActionDrawerManager>
  );
}

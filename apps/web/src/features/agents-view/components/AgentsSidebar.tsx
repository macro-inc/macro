import { createListController } from '@app/components/list';
import {
  CollapsibleSection,
  SearchBar,
  useViewControlHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import { SidebarCreateButton } from '@app/components/view-shell/SidebarCreateButton';
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
import ChatIcon from '@phosphor/chat-circle.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { Key } from '@solid-primitives/keyed';
import { cn } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { compactAge } from '../core/format-age';
import type { AgentsMode } from '../core/mode';
import {
  type AgentConversationEntity,
  type ConversationGroup,
  conversationTimestamp,
} from '../core/recent-conversations';
import { AgentSessionListItem } from '../views/AgentSessionListItem';

const AGENTS_ACTION_VIEW_CONTEXT: EntityActionViewContext = {
  supportsMarkDone: false,
  senderBucket: undefined,
};

export type AgentsSidebarProps = {
  modeForConversation: (conversation: AgentConversationEntity) => AgentsMode;
  activeConversationId: string | undefined;
  search: string;
  groups: ConversationGroup[];
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
  return (
    <SoupEntityContextMenu
      entity={props.conversation}
      list={props.list}
      selectedEntities={() => []}
      viewContext={AGENTS_ACTION_VIEW_CONTEXT}
      as="div"
      class="block w-full"
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
  const conversations = () =>
    props.groups.flatMap((group) => group.conversations);
  const actionController = createListController({
    items: conversations,
    getKey: (conversation) => conversation.id,
    isSelectable: () => false,
  });
  const actionList = toEntityActionListState({
    controller: actionController,
    getEntity: (conversation) => conversation,
  });
  const total = () =>
    props.groups.reduce((sum, group) => sum + group.conversations.length, 0);

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
      run: () => {
        openSearch();
        return true;
      },
    },
  });

  return (
    <MaybeSoupEntityActionDrawerManager>
      <ViewSidebar.Root aria-label="Agents navigation">
        <ViewSidebar.Header>
          <div class="flex min-w-0 items-center gap-1">
            <ViewSidebar.CloseButton />
            <ViewSidebar.Title>Agents</ViewSidebar.Title>
          </div>
        </ViewSidebar.Header>

        <ViewSidebar.Primary>
          <SidebarCreateButton
            label="New conversation"
            onCreate={props.onNewConversation}
          />
        </ViewSidebar.Primary>

        <ViewSidebar.Content class="overflow-hidden">
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
                onScroll={(event) => {
                  const list = event.currentTarget;
                  if (!props.hasNextPage || props.loadingNextPage) return;
                  if (
                    list.scrollTop + list.clientHeight >=
                    list.scrollHeight - 200
                  ) {
                    props.onLoadMore();
                  }
                }}
              >
                <Key each={props.groups} by="id">
                  {(group) => (
                    <>
                      <Show when={group().label}>
                        {(label) => (
                          <ViewSidebar.Toolbar>
                            <h3 class="text-xs font-medium text-ink-muted">
                              {label()}
                            </h3>
                            <span class="text-xs text-ink-extra-muted tabular-nums">
                              {group().conversations.length}
                            </span>
                          </ViewSidebar.Toolbar>
                        )}
                      </Show>
                      <Key each={group().conversations} by="id">
                        {(conversation) => (
                          <ConversationContextMenu
                            conversation={conversation()}
                            list={actionList}
                          >
                            <Row
                              conversation={conversation()}
                              mode={props.modeForConversation(conversation())}
                              active={
                                props.activeConversationId === conversation().id
                              }
                              onOpen={(event) =>
                                props.onOpenConversation(conversation(), event)
                              }
                            />
                          </ConversationContextMenu>
                        )}
                      </Key>
                    </>
                  )}
                </Key>
                <Show when={props.loading}>
                  <p class="px-(--sidebar-item-inset) py-2 text-xs text-ink-muted">
                    Loading conversations…
                  </p>
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
                      : 'No conversations yet.'}
                  </p>
                </Show>
                <Show when={props.loadingNextPage}>
                  <p class="px-(--sidebar-item-inset) py-2 text-xs text-ink-muted">
                    Loading more…
                  </p>
                </Show>
              </ViewSidebar.Nav>
            </CollapsibleSection.Content>
          </CollapsibleSection.Root>
        </ViewSidebar.Content>
      </ViewSidebar.Root>
    </MaybeSoupEntityActionDrawerManager>
  );
}

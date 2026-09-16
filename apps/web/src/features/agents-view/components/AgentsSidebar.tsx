import { useViewControlHotkeys, ViewSidebar } from '@app/components/view-shell';
import { SidebarCreateButton } from '@app/components/view-shell/SidebarCreateButton';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import ChatIcon from '@phosphor/chat-circle.svg';
import CodeIcon from '@phosphor/code.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { Key } from '@solid-primitives/keyed';
import { createSignal, For, Show } from 'solid-js';
import {
  conversationState,
  conversationStateLabel,
} from '../core/conversation-state';
import { compactAge } from '../core/format-age';
import type { AgentsMode } from '../core/mode';
import {
  type AgentConversationEntity,
  type ConversationGroup,
  conversationBotId,
  conversationTimestamp,
} from '../core/recent-conversations';

export type AgentsSidebarProps = {
  modeForConversation: (conversation: AgentConversationEntity) => AgentsMode;
  activeConversationId: string | undefined;
  search: string;
  groups: ConversationGroup[];
  loading: boolean;
  error: boolean;
  hasNextPage: boolean;
  loadingNextPage: boolean;
  /** The bot behind a session, as `@handle`, when the roster knows it. */
  handleForBot: (botId: string | undefined) => string | undefined;
  onNewConversation: () => void;
  onSearchChange: (search: string) => void;
  onOpenConversation: (
    conversation: AgentConversationEntity,
    event?: MouseEvent
  ) => void;
  onRetry: () => void;
  onLoadMore: () => void;
};

function Row(props: {
  conversation: AgentConversationEntity;
  mode: AgentsMode;
  active: boolean;
  handle: string | undefined;
  onOpen: (event: MouseEvent) => void;
}) {
  const title = () => props.conversation.name || 'Untitled chat';
  const state = () =>
    props.conversation.type === 'agent_session'
      ? conversationState(props.conversation.status)
      : undefined;
  const age = () => compactAge(conversationTimestamp(props.conversation));
  const stateLabel = () => {
    const current = state();
    return current ? conversationStateLabel(current) : undefined;
  };

  return (
    <button
      type="button"
      class={props.active ? 'row active' : 'row'}
      title={title()}
      data-kind={props.mode}
      aria-current={props.active ? 'page' : undefined}
      onClick={props.onOpen}
    >
      <span class="lead">
        <Show
          when={state() === 'starting'}
          fallback={
            <Show
              when={props.mode === 'code'}
              fallback={<ChatIcon class="ph" />}
            >
              <CodeIcon class="ph" />
            </Show>
          }
        >
          <span class="spin" />
        </Show>
      </span>
      <span class="truncate">{title()}</span>
      <Show
        when={props.mode === 'code'}
        fallback={<span class="when">{age()}</span>}
      >
        <span />
        <span class="sub">
          <Show when={props.handle}>
            {(handle) => <span class="h">@{handle()}</span>}
          </Show>
          <Show when={props.handle && stateLabel()}>
            <span>·</span>
          </Show>
          <Show when={stateLabel()}>{(label) => <span>{label()}</span>}</Show>
          <span class="when" style={{ 'margin-left': 'auto' }}>
            {age()}
          </span>
        </span>
      </Show>
    </button>
  );
}

export function AgentsSidebar(props: AgentsSidebarProps) {
  const panel = useSplitPanelOrThrow();
  const [searchOpen, setSearchOpen] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;
  const total = () =>
    props.groups.reduce((sum, group) => sum + group.conversations.length, 0);

  const openSearch = () => {
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
    <aside class="aside" aria-label="Agents navigation">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <SplitPanel.CloseButton />
          <ViewSidebar.Title>Agents</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>

      <div class="content" data-view="agents">
        <div class="top-actions">
          <SidebarCreateButton
            label="New conversation"
            onCreate={props.onNewConversation}
          />
        </div>

        <section class="recent">
          <div class="sec-head">
            <h2>Conversations</h2>
            <button
              type="button"
              class="icon-btn"
              aria-pressed={searchOpen()}
              aria-label="Search conversations"
              onClick={() => (searchOpen() ? closeSearch() : openSearch())}
            >
              <MagnifyingGlassIcon class="ph" />
            </button>
          </div>
          <Show when={searchOpen()}>
            <div class="search">
              <MagnifyingGlassIcon class="ph" />
              <input
                ref={searchInput}
                placeholder="Search conversations"
                aria-label="Search conversations"
                value={props.search}
                onInput={(event) =>
                  props.onSearchChange(event.currentTarget.value)
                }
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !props.search) closeSearch();
                }}
              />
            </div>
          </Show>
          <nav
            class="list"
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
            <For each={props.groups}>
              {(group) => (
                <>
                  <Show when={group.label}>
                    {(label) => (
                      <div class="group-h">
                        {label()}
                        <span class="n">{group.conversations.length}</span>
                      </div>
                    )}
                  </Show>
                  <Key each={group.conversations} by="id">
                    {(conversation) => (
                      <Row
                        conversation={conversation()}
                        mode={props.modeForConversation(conversation())}
                        active={
                          props.activeConversationId === conversation().id
                        }
                        handle={props.handleForBot(
                          conversationBotId(conversation())
                        )}
                        onOpen={(event) =>
                          props.onOpenConversation(conversation(), event)
                        }
                      />
                    )}
                  </Key>
                </>
              )}
            </For>
            <Show when={props.loading}>
              <p class="list-note">Loading conversations…</p>
            </Show>
            <Show when={props.error}>
              <button type="button" class="row" onClick={props.onRetry}>
                <span class="lead" />
                <span class="truncate">Retry loading</span>
              </button>
            </Show>
            <Show when={!props.loading && !props.error && total() === 0}>
              <p class="list-note">
                {props.search.trim()
                  ? `No results for "${props.search.trim()}"`
                  : 'No conversations yet.'}
              </p>
            </Show>
            <Show when={props.loadingNextPage}>
              <p class="list-note">Loading more…</p>
            </Show>
          </nav>
        </section>
      </div>
    </aside>
  );
}

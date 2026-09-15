import { useViewControlHotkeys } from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import MacroLogo from '@icon/macro-logo.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
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
  type AgentConversationTarget,
  type ConversationGroup,
  conversationBotId,
  conversationTimestamp,
} from '../core/recent-conversations';

const MODE_COPY = {
  chat: {
    newAction: 'New chat',
    listTitle: 'Chats',
    searchLabel: 'Search agent chats',
    searchPlaceholder: 'Search chats',
    empty: 'No chats yet.',
    loading: 'Loading chats…',
  },
  code: {
    newAction: 'New session',
    listTitle: 'Sessions',
    searchLabel: 'Search coder sessions',
    searchPlaceholder: 'Search sessions',
    empty: 'No coder sessions yet.',
    loading: 'Loading sessions…',
  },
} as const satisfies Record<AgentsMode, Record<string, string>>;

export type AgentsSidebarProps = {
  mode: AgentsMode;
  /** Whether Code is offered at all. Off, the switch is hidden. */
  modeSwitch: boolean;
  activeConversationId: string | undefined;
  search: string;
  groups: ConversationGroup[];
  loading: boolean;
  error: boolean;
  hasNextPage: boolean;
  loadingNextPage: boolean;
  /** The bot behind a session, as `@handle`, when the roster knows it. */
  handleForBot: (botId: string | undefined) => string | undefined;
  onModeChange: (mode: AgentsMode) => void;
  onNewConversation: () => void;
  onSearchChange: (search: string) => void;
  onOpenConversation: (conversation: AgentConversationTarget) => void;
  onRetry: () => void;
  onLoadMore: () => void;
};

function Row(props: {
  conversation: AgentConversationEntity;
  mode: AgentsMode;
  active: boolean;
  handle: string | undefined;
  onOpen: () => void;
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
      onClick={props.onOpen}
    >
      <span class="lead">
        <Show when={state() === 'starting'}>
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
  const copy = () => MODE_COPY[props.mode];
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
      <header>
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '4px',
            'min-width': 0,
          }}
        >
          <SplitPanel.CloseButton />
          <h1>Agents</h1>
        </div>
        <div class="ctl">
          <SplitPanel.BackButton />
          <SplitPanel.ForwardButton />
        </div>
      </header>

      <Show when={props.modeSwitch}>
        <div class="seg side" role="tablist" aria-label="Section">
          <button
            type="button"
            role="tab"
            aria-pressed={props.mode === 'chat'}
            aria-selected={props.mode === 'chat'}
            onClick={() => props.onModeChange('chat')}
          >
            <MacroLogo class="ph" />
            Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-pressed={props.mode === 'code'}
            aria-selected={props.mode === 'code'}
            onClick={() => props.onModeChange('code')}
          >
            <RobotIcon class="ph" />
            Code
          </button>
        </div>
      </Show>

      <div class="content" data-view="agents">
        <div class="top-actions">
          <button
            type="button"
            class="newbtn"
            onClick={props.onNewConversation}
          >
            <PlusIcon class="ph" />
            <span>{copy().newAction}</span>
          </button>
        </div>

        <section class="recent">
          <div class="sec-head">
            <h2>{copy().listTitle}</h2>
            <button
              type="button"
              class="icon-btn"
              aria-pressed={searchOpen()}
              aria-label={copy().searchLabel}
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
                placeholder={copy().searchPlaceholder}
                aria-label={copy().searchLabel}
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
            aria-label={`Recent ${copy().listTitle.toLowerCase()}`}
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
                        mode={props.mode}
                        active={
                          props.activeConversationId === conversation().id
                        }
                        handle={props.handleForBot(
                          conversationBotId(conversation())
                        )}
                        onOpen={() => props.onOpenConversation(conversation())}
                      />
                    )}
                  </Key>
                </>
              )}
            </For>
            <Show when={props.loading}>
              <p class="list-note">{copy().loading}</p>
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
                  : copy().empty}
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

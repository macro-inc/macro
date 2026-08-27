import { activeAppLayout } from '@app/features/app-layout/layout-state';
import { SoupChatInput } from '@app/features/chat/SoupChatInput';
import { createSoupState } from '@app/features/next-soup/create-soup-state';
import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { SoupContextProvider } from '@app/features/next-soup/soup-context';
import { SoupEntityContextMenu } from '@app/features/next-soup/soup-view/soup-entity-context-menu';
import { SoupViewContextProvider } from '@app/features/next-soup/soup-view/soup-view-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { EmptyChatState } from '@core/component/AI/component/message/EmptyChatState';
import { createBlockInstance } from '@core/orchestrator';
import { Entity } from '@entity';
import type { ChatEntity, EntityData } from '@entity/types/entity';
import type { WithNotification } from '@entity/types/notification';
import { unreadFilterFn } from '@entity/utils/filter';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import {
  type SoupItemsQueryArgs,
  useSoupItemsQuery,
} from '@queries/soup/items';
import { useNavigate, useParams } from '@solidjs/router';
import { Button, cn } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

export const CHAT_HISTORY_QUERY: SoupItemsQueryArgs = {
  params: { sort_method: 'updated_at', limit: 100 },
  body: { ...QUERY_FILTERS_BASE, chat_filters: undefined },
};

export function isChatEntity(entity: EntityData): entity is ChatEntity {
  return entity.type === 'chat';
}

export function ExperimentalChatHistoryItem(props: {
  chat: ChatEntity;
  active: boolean;
  onOpen: () => void;
}) {
  const unread = () =>
    unreadFilterFn(props.chat as WithNotification<EntityData>);

  return (
    <SoupEntityContextMenu entity={props.chat}>
      <button
        type="button"
        class={cn(
          'group/chat flex w-full shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left outline-none transition-colors',
          props.active
            ? 'bg-active text-ink'
            : 'text-ink-muted hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40'
        )}
        aria-current={props.active ? 'page' : undefined}
        onClick={props.onOpen}
      >
      <span class="min-w-0 flex-1 truncate text-sm font-medium">
        {props.chat.name || 'Untitled chat'}
      </span>
      <span class="flex shrink-0 items-center">
        <span class="max-w-0 overflow-hidden whitespace-nowrap text-xs font-light text-ink-extra-muted opacity-0 transition-[max-width,opacity,margin] group-hover/chat:ml-2 group-hover/chat:max-w-24 group-hover/chat:opacity-100">
          <Entity.Timestamp entity={props.chat} />
        </span>
        <Show when={unread()}>
          <span
            aria-label="Unread"
            class="ml-2 size-2 shrink-0 rounded-full bg-accent"
          />
        </Show>
      </span>
    </button>
    </SoupEntityContextMenu>
  );
}

function ChatHistorySection(props: {
  chats: ChatEntity[];
  selectedChatId: string | undefined;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
}) {
  const [search, setSearch] = createSignal('');
  const visibleChats = createMemo(() => {
    const query = search().trim().toLocaleLowerCase();
    if (!query) return props.chats;
    return props.chats.filter((chat) =>
      chat.name.toLocaleLowerCase().includes(query)
    );
  });

  return (
    <SidePanel.Section id="chat-history" title="Chats" defaultOpen order={0}>
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <div class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-2xl bg-ink/4 px-3 text-ink-muted focus-within:ring-2 focus-within:ring-accent/30">
            <MagnifyingGlassIcon class="size-3.5 shrink-0" />
            <input
              type="search"
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search chats"
              class="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
            />
          </div>
          <Button
            variant="cta"
            size="sm"
            class="h-9 shrink-0 rounded-full px-3"
            onClick={props.onNewChat}
          >
            <PlusIcon class="size-3.5" />
            <span>New</span>
          </Button>
        </div>
        <Show
          when={visibleChats().length > 0}
          fallback={
            <div class="px-3 py-6 text-center text-sm text-ink-extra-muted">
              No chats found
            </div>
          }
        >
          <div class="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            <For each={visibleChats()}>
              {(chat) => (
                <ExperimentalChatHistoryItem
                  chat={chat}
                  active={props.selectedChatId === chat.id}
                  onOpen={() => props.onSelectChat(chat.id)}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </SidePanel.Section>
  );
}

export function ChatWorkspaceMain(props: {
  activeChatBlock: ReturnType<typeof createBlockInstance> | undefined;
  onChatCreated: (chatId: string) => void;
}) {
  return (
    <div class="relative size-full min-h-0 bg-panel">
      <Switch>
        <Match when={props.activeChatBlock}>
          {(block) => (
            <div class="size-full min-h-0">
              <Dynamic component={block().element} />
            </div>
          )}
        </Match>
        <Match when={activeAppLayout().capabilities.aiChatHome}>
          {/* ChatGPT-style home: the composer alone, centered mid-screen and
              nudged a touch above true center so it reads as seated, not
              sinking. History lives in the side panel. */}
          <div class="flex size-full min-h-0 flex-col items-center justify-center px-4 pb-[12vh]">
            <div class="w-full max-w-3xl">
              <SoupChatInput
                placement="centered"
                onChatCreated={props.onChatCreated}
              />
            </div>
          </div>
        </Match>
        <Match when={true}>
          <div class="flex size-full min-h-0 flex-col">
            <div class="min-h-0 flex-1 overflow-y-auto pb-28">
              <EmptyChatState />
            </div>
            <SoupChatInput onChatCreated={props.onChatCreated} />
          </div>
        </Match>
      </Switch>
    </div>
  );
}

/** Standalone chat workspace that keeps chat history beside the active block. */
export function ExperimentalChatView() {
  const soup = createSoupState();
  const panel = useSplitPanelOrThrow();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const chatsQuery = useSoupItemsQuery(() => CHAT_HISTORY_QUERY);

  onMount(() => panel.handle.setDisplayName('Chat'));

  const selectedChatId = () =>
    typeof params.id === 'string' && params.id.length > 0
      ? params.id
      : undefined;
  const chats = createMemo(() => (chatsQuery.data ?? []).filter(isChatEntity));
  const activeChatBlock = createMemo(() => {
    const id = selectedChatId();
    return id ? createBlockInstance('chat', id) : undefined;
  });

  const selectChat = (chatId: string | undefined) => {
    navigate(chatId ? `/chat/${encodeURIComponent(chatId)}` : '/chat', {
      replace: true,
    });
    globalSplitManager()?.returnFocus();
  };

  return (
    <SoupContextProvider soup={soup}>
      <SoupViewContextProvider soup={soup} initialEnabled>
        <SidePanel.Layout defaultOpen narrowThreshold={640}>
          <ChatHistorySection
            chats={chats()}
            selectedChatId={selectedChatId()}
            onSelectChat={(chatId) => selectChat(chatId)}
            onNewChat={() => selectChat(undefined)}
          />
          <ChatWorkspaceMain
            activeChatBlock={activeChatBlock()}
            onChatCreated={(chatId) => selectChat(chatId)}
          />
        </SidePanel.Layout>
      </SoupViewContextProvider>
    </SoupContextProvider>
  );
}

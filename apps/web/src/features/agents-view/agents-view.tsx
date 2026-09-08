import {
  SearchBar,
  useViewControlHotkeys,
  ViewShell,
} from '@app/components/view-shell';
import { runCreateAction } from '@app/features/command/Launcher';
import { ViewFavorites } from '@app/features/favorites/view-favorites';
import { HomeChatInput } from '@app/features/home/home';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { Agents } from '@app/features/settings/Agents';
import { ConnectedAccounts } from '@app/features/settings/ConnectedAccounts';
import { favoriteSplitContent } from '@app/util/favorites';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { ChatInputProvider } from '@core/component/AI/context';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useUserId } from '@core/context/user';
import { type ChatEntity, ListEntityMetadataQueryProvider } from '@entity';
import ChatIcon from '@phosphor/chat-circle.svg';
import ClockIcon from '@phosphor/clock-clockwise.svg';
import PlugsIcon from '@phosphor/plugs.svg';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import SkillIcon from '@phosphor/sparkle.svg';
import { useAutomationEntities } from '@queries/agent-schedule/entities';
import { useSoupAstItemsQuery, useSoupItemsQuery } from '@queries/soup/items';
import {
  getStreamState,
  subscribeToStreamState,
} from '@service-connection/stream-events';
import { Button, cn } from '@ui';
import { createSignal, For, Match, Show, Suspense, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';

type Page = 'new' | 'routines' | 'agents' | 'connections' | 'skills';
const PAGES = [
  { id: 'new', label: 'New Chat', icon: PlusIcon },
  { id: 'routines', label: 'Routines', icon: ClockIcon },
  { id: 'agents', label: 'Agents', icon: RobotIcon },
  { id: 'connections', label: 'Connections', icon: PlugsIcon },
  { id: 'skills', label: 'Skills', icon: SkillIcon },
] as const;

function ChatRow(props: {
  chat: ChatEntity;
  selected: boolean;
  onOpen: () => void;
}) {
  subscribeToStreamState(props.chat.id, 'chat');
  const stream = getStreamState(props.chat.id);
  const running = () => stream()?.type === 'created';
  return (
    <Button
      variant="ghost"
      class={cn(
        'h-9 w-full shrink-0 justify-start gap-3 rounded-xl px-3 font-normal',
        props.selected && 'bg-active text-ink'
      )}
      aria-pressed={props.selected}
      title={props.chat.name || 'Untitled chat'}
      onClick={props.onOpen}
    >
      <span class="flex size-4 shrink-0 items-center justify-center">
        <Show
          when={running()}
          fallback={<ChatIcon class="size-4 text-ink-extra-muted" />}
        >
          <span
            role="status"
            aria-label="Agent working"
            class="flex size-4 items-center justify-center rounded-full bg-accent/10"
          >
            <span class="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
          </span>
        </Show>
      </span>
      <span class="min-w-0 truncate text-sm">
        {props.chat.name || 'Untitled chat'}
      </span>
    </Button>
  );
}

function AgentsWorkspace() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const layout = useSplitLayout();
  const userId = useUserId();
  const [page, setPage] = createSignal<Page>('new');
  const [selected, setSelected] = createSignal<ChatEntity>();
  const [search, setSearch] = createSignal('');
  const [draftKey, setDraftKey] = createSignal(0);
  const query = useSoupItemsQuery(() => ({
    params: { sort_method: 'updated_at', limit: 100 },
    body: { ...QUERY_FILTERS_BASE, chat_filters: undefined },
  }));
  const chats = () =>
    (query.isSuccess ? query.data : [])
      ?.filter((entity): entity is ChatEntity => entity.type === 'chat')
      .filter((chat) =>
        chat.name.toLowerCase().includes(search().toLowerCase())
      ) ?? [];
  let searchInput: HTMLInputElement | undefined;
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search agent chats',
      run: () => {
        searchInput?.focus();
        return true;
      },
    },
  });
  const navigate = (next: Page) => {
    setSelected(undefined);
    setPage(next);
    if (next === 'new') setDraftKey((key) => key + 1);
  };
  const openChat = (chat: ChatEntity) => {
    setPage('new');
    setSelected(chat);
  };
  const title = () =>
    PAGES.find((item) => item.id === page())?.label ?? 'New Chat';
  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ViewShell.Root
          resizable
          aside={{ width: 320, min: 224, max: 380 }}
          breakpoints={{ collapsed: 0 }}
          layoutBreakpoint="collapsed"
          main={{ min: 280 }}
        >
          <ViewShell.Aside>
            <aside
              aria-label="Agents navigation"
              class="flex size-full min-h-0 flex-col border-r border-edge-muted bg-sidebar"
            >
              <header class="flex h-12 shrink-0 items-center border-b border-edge-muted px-5">
                <h1 class="text-xl font-semibold tracking-tight text-ink">
                  Agents
                </h1>
              </header>
              <div class="shrink-0 px-3 pt-3 pb-2">
                <SearchBar
                  label="Search agent chats"
                  placeholder="Search chats"
                  ref={(el) => (searchInput = el)}
                  value={search()}
                  onValueChange={setSearch}
                  class="h-9 rounded-lg border border-edge-muted bg-transparent"
                />
              </div>
              <nav
                aria-label="Agent views"
                class="flex shrink-0 flex-col gap-0.5 px-3"
              >
                <For each={PAGES}>
                  {(item) => (
                    <Button
                      variant="ghost"
                      class={cn(
                        'h-9 justify-start gap-3 rounded-xl px-3 font-normal',
                        page() === item.id &&
                          !selected() &&
                          'bg-active text-ink'
                      )}
                      aria-pressed={page() === item.id && !selected()}
                      onClick={() => navigate(item.id)}
                    >
                      <Dynamic
                        component={item.icon}
                        class="size-4 text-ink-muted"
                      />
                      {item.label}
                    </Button>
                  )}
                </For>
              </nav>
              <div class="mt-5 shrink-0 px-3">
                <ViewFavorites
                  view="agents"
                  onOpen={(favorite) => {
                    const chat = chats().find(
                      (chat) => chat.id === favorite.entityId
                    );
                    if (chat) openChat(chat);
                    else layout.openWithSplit(favoriteSplitContent(favorite));
                  }}
                />
              </div>
              <div class="mt-5 flex min-h-0 flex-1 flex-col px-3 pb-3">
                <h2 class="mb-2 shrink-0 px-3 text-xs text-ink-muted">
                  Recent chats
                </h2>
                <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                  <For each={chats()}>
                    {(chat) => (
                      <ChatRow
                        chat={chat}
                        selected={selected()?.id === chat.id}
                        onOpen={() => openChat(chat)}
                      />
                    )}
                  </For>
                  <Show when={query.isPending}>
                    <p class="px-3 py-2 text-xs text-ink-muted">
                      Loading chats…
                    </p>
                  </Show>
                  <Show when={query.isError}>
                    <Button
                      variant="ghost"
                      onClick={() => void query.refetch()}
                    >
                      Retry loading chats
                    </Button>
                  </Show>
                  <Show when={query.isSuccess && chats().length === 0}>
                    <p class="px-3 py-2 text-xs text-ink-muted">
                      {search() ? 'No matching chats' : 'No chats yet'}
                    </p>
                  </Show>
                  <Show when={query.hasNextPage}>
                    <Button
                      variant="ghost"
                      disabled={query.isFetchingNextPage}
                      onClick={() => void query.fetchNextPage()}
                      class="h-9 shrink-0 text-xs text-ink-muted"
                    >
                      {query.isFetchingNextPage ? 'Loading…' : 'More chats'}
                    </Button>
                  </Show>
                </div>
              </div>
            </aside>
          </ViewShell.Aside>
          <ViewShell.Main>
            <Show
              when={selected()}
              keyed
              fallback={
                <>
                  <header class="flex h-12 shrink-0 items-center border-b border-edge-muted px-4">
                    <h2 class="text-sm font-semibold">{title()}</h2>
                  </header>
                  <div class="min-h-0 flex-1">
                    <Suspense
                      fallback={
                        <div class="p-6 text-sm text-ink-muted">Loading…</div>
                      }
                    >
                      <Switch>
                        <Match when={page() === 'new'}>
                          <div class="flex size-full items-center justify-center px-6 pb-16">
                            <div class="w-full max-w-2xl">
                              <Show when={{ key: draftKey() }} keyed>
                                <ChatInputProvider>
                                  <HomeChatInput
                                    onChatCreated={(chat) =>
                                      openChat({
                                        ...chat,
                                        type: 'chat',
                                        ownerId: userId() ?? '',
                                      })
                                    }
                                  />
                                </ChatInputProvider>
                              </Show>
                            </div>
                          </div>
                        </Match>
                        <Match when={page() === 'agents'}>
                          <Agents />
                        </Match>
                        <Match when={page() === 'connections'}>
                          <ConnectedAccounts />
                        </Match>
                        <Match
                          when={page() === 'routines' || page() === 'skills'}
                        >
                          <Show when={page()} keyed>
                            {(current) => (
                              <AgentResourceList
                                page={current as 'routines' | 'skills'}
                              />
                            )}
                          </Show>
                        </Match>
                      </Switch>
                    </Suspense>
                  </div>
                </>
              }
            >
              {(chat) => (
                <Suspense>
                  <PreviewPanel
                    selectedEntity={chat}
                    orchestrator={orchestrator}
                    splitPanelContext={panel}
                    headerClass="h-12 min-h-12 border-b border-edge-muted"
                  />
                </Suspense>
              )}
            </Show>
          </ViewShell.Main>
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 border-b border-edge-muted"
          />
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}

function AgentResourceList(props: { page: 'routines' | 'skills' }) {
  const layout = useSplitLayout();
  const automations = useAutomationEntities();
  const skillsQuery = useSoupAstItemsQuery(
    () => ({
      params: { limit: 100, sort_method: 'updated_at' },
      body: compileToAst(
        queryStateFrom(defineQueryFilters({ include: { subType: ['skill'] } }))
      ),
    }),
    () => ({ enabled: props.page === 'skills' })
  );
  const items = () =>
    props.page === 'routines'
      ? automations()
      : skillsQuery.isLoading
        ? []
        : (skillsQuery.data?.entities ?? []);
  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex h-12 shrink-0 items-center border-b border-edge-muted px-4">
        <Button
          variant="ghost"
          size="sm"
          class="h-8 gap-2 rounded-lg bg-ink/4 px-3"
          onClick={() =>
            runCreateAction(props.page === 'routines' ? 'automation' : 'skill')
          }
        >
          <PlusIcon class="size-3.5" />
          {props.page === 'routines' ? 'New routine' : 'New skill'}
        </Button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <For each={items()}>
          {(item) => (
            <Button
              variant="ghost"
              class="h-12 w-full justify-start gap-3 rounded-xl px-3 font-normal"
              onClick={() =>
                layout.openWithSplit({
                  type: props.page === 'routines' ? 'automation' : 'md',
                  id: item.id,
                })
              }
            >
              <Dynamic
                component={props.page === 'routines' ? ClockIcon : SkillIcon}
                class="size-4 text-ink-muted"
              />
              <span class="truncate">{item.name}</span>
            </Button>
          )}
        </For>
        <Show when={items().length === 0}>
          <p class="px-3 py-6 text-sm text-ink-muted">
            {skillsQuery.isLoading && props.page === 'skills'
              ? 'Loading skills…'
              : `No ${props.page} yet`}
          </p>
        </Show>
        <Show when={props.page === 'skills' && skillsQuery.error}>
          <Button variant="ghost" onClick={() => void skillsQuery.refresh()}>
            Retry loading skills
          </Button>
        </Show>
        <Show when={props.page === 'skills' && skillsQuery.hasNextPage}>
          <Button
            variant="ghost"
            disabled={skillsQuery.isFetchingNextPage}
            onClick={() => void skillsQuery.fetchNextPage()}
          >
            More skills
          </Button>
        </Show>
      </div>
    </div>
  );
}

export function AgentsView() {
  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <AgentsWorkspace />
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}

import {
  useViewControlHotkeys,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import {
  createSidebarSearch,
  SidebarSearchField,
  SidebarSearchToggle,
} from '@app/components/view-shell/sidebar-search';
import {
  pendingSession,
  startPendingSession,
} from '@app/features/block-agent/context/pending-session';
import { AgentInput } from '@app/features/block-agent/ui';
import { runCreateAction } from '@app/features/command/Launcher';
import { ViewFavorites } from '@app/features/favorites/view-favorites';
import { HomeChatInput } from '@app/features/home/home';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { ConnectedAccounts } from '@app/features/settings/ConnectedAccounts';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { favoriteSplitContent } from '@app/util/favorites';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { RightContentPanel } from '@components/app/RightContentPanel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { ChatInputProvider } from '@core/component/AI/context';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { enableChatV3Agents } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { type ChatEntity, ListEntityMetadataQueryProvider } from '@entity';
import ChatIcon from '@phosphor/chat-circle.svg';
import ClockIcon from '@phosphor/clock-clockwise.svg';
import PlugsIcon from '@phosphor/plugs.svg';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import SkillIcon from '@phosphor/sparkle.svg';
import { useAutomationEntities } from '@queries/agent-schedule/entities';
import {
  isRecentAgentSessionWorking,
  useRecentAgentSessions,
} from '@queries/agent-session/recent-sessions';
import { useSoupAstItemsQuery, useSoupItemsQuery } from '@queries/soup/items';
import {
  getStreamState,
  subscribeToStreamState,
} from '@service-connection/stream-events';
import { useSearchParams } from '@solidjs/router';
import { Button, cn } from '@ui';
import { createSignal, For, Match, Show, Suspense, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { AgentSessionPane } from './agent-session-pane';
import { ManagementPreview } from './management-preview';

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
  const agentsFlag = useFeatureFlag(enableChatV3Agents);
  const sessions = useRecentAgentSessions();
  const [selectedSession, setSelectedSession] = createSignal<string>();
  const sessionId = () => {
    const id = selectedSession();
    return id ? (pendingSession(id)?.sessionId() ?? id) : undefined;
  };
  const [localPage, setLocalPage] = createSignal<Page>('new');
  const [viewParams, setViewParams] = useSearchParams();
  const page = (): Page =>
    viewParams.agentView === 'routines' || viewParams.agentView === 'agents'
      ? viewParams.agentView
      : localPage();
  const setPage = (next: Page) => {
    const management = next === 'routines' || next === 'agents';
    setLocalPage(management ? 'new' : next);
    setViewParams({
      agentView: management ? next : undefined,
      agentItem: undefined,
      agentSection: undefined,
    });
  };
  const [selected, setSelected] = createSignal<ChatEntity>();
  const sidebarSearch = createSidebarSearch();
  const search = sidebarSearch.query;
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
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search agent chats',
      run: () => {
        sidebarSearch.open();
        return true;
      },
    },
  });
  const navigate = (next: Page) => {
    setSelected(undefined);
    setSelectedSession(undefined);
    setPage(next);
    if (next === 'new') setDraftKey((key) => key + 1);
  };
  const openChat = (chat: ChatEntity) => {
    setSelectedSession(undefined);
    setPage('new');
    setSelected(chat);
  };
  const openSession = (id: string) => {
    setSelected(undefined);
    setPage('new');
    setSelectedSession(id);
  };
  const conversations = () =>
    [
      ...chats().map((chat) => ({
        kind: 'chat' as const,
        chat,
        id: chat.id,
        name: chat.name,
        date: String(chat.updatedAt ?? chat.createdAt ?? ''),
      })),
      ...(agentsFlag().enabled ? sessions() : []).map((session) => ({
        kind: 'session' as const,
        session,
        id: session.id,
        name: session.name,
        date: session.modifiedAt,
      })),
    ]
      .filter((item) =>
        item.name.toLowerCase().includes(search().toLowerCase())
      )
      .sort((a, b) => b.date.localeCompare(a.date));
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
            <ViewSidebar.Root aria-label="Agents navigation">
              <ViewSidebar.Header>
                <ViewSidebar.Title>Agents</ViewSidebar.Title>
                <SidebarSearchToggle
                  search={sidebarSearch}
                  label="Search agent chats"
                />
              </ViewSidebar.Header>
              <Show when={!sidebarSearch.isOpen()}>
                <nav
                  aria-label="Agent views"
                  class="flex shrink-0 flex-col gap-0.5 px-4 pt-4"
                >
                  <For each={PAGES}>
                    {(item) => (
                      <Button
                        variant="ghost"
                        class={cn(
                          'h-9 justify-start gap-3 rounded-xl px-3 font-normal',
                          page() === item.id &&
                            !selected() &&
                            !selectedSession() &&
                            'bg-active text-ink'
                        )}
                        aria-pressed={
                          page() === item.id &&
                          !selected() &&
                          !selectedSession()
                        }
                        title={item.label}
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
                <div class="mt-6 shrink-0 px-4">
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
              </Show>
              <Show when={sidebarSearch.isOpen()}>
                <SidebarSearchField
                  search={sidebarSearch}
                  label="Search agent chats"
                />
              </Show>
              <div
                class={cn(
                  'flex min-h-0 flex-1 flex-col px-4 pb-4',
                  !sidebarSearch.isOpen() && 'mt-6'
                )}
              >
                <Show when={!sidebarSearch.isOpen()}>
                  <h2 class="mb-1 flex h-7 shrink-0 items-center px-3 text-xs font-medium text-ink-subtle">
                    Recent chats
                  </h2>
                </Show>
                <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                  <For each={conversations()}>
                    {(item) =>
                      item.kind === 'chat' ? (
                        <ChatRow
                          chat={item.chat}
                          selected={selected()?.id === item.id}
                          onOpen={() => openChat(item.chat)}
                        />
                      ) : (
                        <Button
                          variant="ghost"
                          class={cn(
                            'h-9 w-full shrink-0 justify-start gap-3 rounded-xl px-3 font-normal',
                            sessionId() === item.id && 'bg-active text-ink'
                          )}
                          aria-pressed={sessionId() === item.id}
                          title={item.name || 'Agent session'}
                          onClick={() => openSession(item.id)}
                        >
                          <Show
                            when={isRecentAgentSessionWorking(item.id)}
                            fallback={
                              <RobotIcon class="size-4 shrink-0 text-ink-extra-muted" />
                            }
                          >
                            <span
                              role="status"
                              aria-label="Agent working"
                              class="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent/10"
                            >
                              <span class="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
                            </span>
                          </Show>
                          <span class="min-w-0 truncate text-sm">
                            {item.name || 'Agent session'}
                          </span>
                        </Button>
                      )
                    }
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
                  <Show when={query.isSuccess && conversations().length === 0}>
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
            </ViewSidebar.Root>
          </ViewShell.Aside>
          <ViewShell.Main>
            <RightContentPanel
              contentKey={
                sessionId()
                  ? `agent:${sessionId()}`
                  : selected()
                    ? `chat:${selected()!.id}`
                    : `page:${page()}:${viewParams.agentItem ?? ''}`
              }
            >
              <Show
                when={selectedSession()}
                keyed
                fallback={
                  <Show
                    when={selected()}
                    keyed
                    fallback={
                      <>
                        <Show
                          when={page() !== 'routines' && page() !== 'agents'}
                        >
                          <header class="flex h-12 shrink-0 items-center  px-4">
                            <h2 class="text-sm font-semibold">{title()}</h2>
                          </header>
                        </Show>
                        <div class="min-h-0 flex-1">
                          <Suspense
                            fallback={
                              <div class="p-6 text-sm text-ink-muted">
                                Loading…
                              </div>
                            }
                          >
                            <Switch>
                              <Match when={page() === 'new'}>
                                <div class="flex size-full items-center justify-center px-4 py-4">
                                  <div class="w-full max-w-2xl">
                                    <Show when={{ key: draftKey() }} keyed>
                                      <Show
                                        when={agentsFlag().enabled}
                                        fallback={
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
                                        }
                                      >
                                        <AgentInput
                                          placeholder="Message the agent, @mention anything"
                                          onSend={(prompt) =>
                                            openSession(
                                              startPendingSession(prompt)
                                            )
                                          }
                                        />
                                      </Show>
                                    </Show>
                                  </div>
                                </div>
                              </Match>
                              <Match when={page() === 'agents'}>
                                <ManagementPreview kind="agents" />
                              </Match>
                              <Match when={page() === 'connections'}>
                                <ConnectedAccounts />
                              </Match>
                              <Match when={page() === 'routines'}>
                                <ManagementPreview kind="routines" />
                              </Match>
                              <Match when={page() === 'skills'}>
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
                          headerClass="h-12 min-h-12 "
                        />
                      </Suspense>
                    )}
                  </Show>
                }
              >
                {(id) => (
                  <Suspense>
                    <AgentSessionPane id={id} />
                  </Suspense>
                )}
              </Show>
            </RightContentPanel>
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
      <div class="flex h-12 shrink-0 items-center  px-4">
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

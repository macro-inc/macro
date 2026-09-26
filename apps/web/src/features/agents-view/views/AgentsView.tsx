import { ViewShell } from '@app/components/view-shell';
import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { AgentSettings } from '@app/features/settings/AgentSettings';
import { McpConnections } from '@app/features/settings/McpConnections';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { previewBlockTarget } from '@components/app/previewTarget';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { ChatEmptyStateContext } from '@core/component/AI/component/message/EmptyChatState';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { useSoupItemsQuery } from '@queries/soup/items';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import '../agents-view.css';
import { AgentSessionPane } from '../components/AgentSessionPane';
import { AgentsSidebar } from '../components/AgentsSidebar';
import { Topbar } from '../components/Topbar';
import { DataModeProvider, dataModeFor } from '../context/data-mode';
import { type AgentKind, modeForKind } from '../core/agent-kind';
import type { AgentsMode } from '../core/mode';
import { type AgentsPage, parseAgentsPage } from '../core/pages';
import {
  type AgentConversationEntity,
  type AgentConversationTarget,
  conversationMode,
  groupConversations,
  selectRecentAgentConversations,
} from '../core/recent-conversations';
import { kindForBot } from '../core/roster';
import { type AgentsRoute, agentsRouteId } from '../core/route';
import { createAgentRosterSource } from '../queries/agent-roster-source';
import { NewChatPage, type StartConversation } from './NewChatPage';

type SelectedConversation = {
  conversation: AgentConversationTarget;
  activeConversationId: string;
};

function LoadingComposer() {
  return (
    <div class="grid size-full place-items-center text-ink-muted">
      <SpinnerIcon
        aria-label="Loading agent composer"
        class="size-5 animate-spin"
      />
    </div>
  );
}

function AgentsWorkspace(props: { initialRoute?: AgentsRoute }) {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const orchestrator = useGlobalBlockOrchestrator();
  const userId = useUserId();
  const notifications = useGlobalNotificationSource();
  const mode = (): AgentsMode => props.initialRoute?.mode ?? 'chat';
  const dataMode = () => dataModeFor(mode());
  const [page, setPage] = createSignal<AgentsPage>('new');
  const [selected, setSelected] = createSignal<
    SelectedConversation | undefined
  >(
    props.initialRoute
      ? {
          conversation: props.initialRoute.conversation,
          activeConversationId: props.initialRoute.conversation.id,
        }
      : undefined
  );
  const [search, setSearch] = createSignal('');
  const rosterSource = createAgentRosterSource();
  const query = useSoupItemsQuery(
    () => {
      const ownerId = userId();
      return {
        params: { sort_method: 'updated_at', limit: 100 },
        body: {
          ...QUERY_FILTERS_BASE,
          chat_filters: { owners: ownerId ? [ownerId] : [] },
          agent_session_filters: {
            include: true,
            owners: ownerId ? [ownerId] : [],
          },
        },
      };
    },
    () => ({ enabled: Boolean(userId()) })
  );
  const conversations = createMemo(() =>
    selectRecentAgentConversations(
      query.isSuccess
        ? query.data.map((entity) =>
            withEntityNotifications(entity, notifications)
          )
        : [],
      userId(),
      search()
    )
  );
  const groups = createMemo(() => groupConversations(conversations()));
  const modeForConversation = (conversation: AgentConversationEntity) =>
    conversationMode(conversation, (botId) =>
      kindForBot(botId, rosterSource.roster())
    );

  onMount(() => panel.handle.setDisplayName('Agents'));

  const showComposer = () => {
    if (panel.handle.content().id !== 'agents') {
      panel.handle.replace({ next: { type: 'component', id: 'agents' } });
      return;
    }
    setSelected(undefined);
    setPage('new');
  };
  // A launcher navigation can target this already-mounted workspace.
  createEffect(
    on(
      () => {
        const content = panel.handle.content();
        return content.type === 'component'
          ? content.params?.focusComposer
          : undefined;
      },
      (request) => {
        if (request) showComposer();
      }
    )
  );
  const openPage = (next: AgentsPage) => {
    setSelected(undefined);
    setPage(next);
  };
  createEffect(
    on(
      () => {
        const content = panel.handle.content();
        return content.type === 'component'
          ? content.params?.agentPageRequest
          : undefined;
      },
      () => {
        const content = panel.handle.content();
        const next =
          content.type === 'component'
            ? parseAgentsPage(content.params?.agentPage)
            : undefined;
        if (next) openPage(next);
      }
    )
  );
  const openRoster = (_kind: AgentKind) => {
    setSelected(undefined);
    setPage('agents');
  };
  const openConversation = (
    conversation: AgentConversationTarget,
    event?: MouseEvent,
    targetMode: AgentsMode = mode()
  ) => {
    const next = {
      type: 'component' as const,
      id: agentsRouteId({ mode: targetMode, conversation }),
    };
    if (!event?.shiftKey && panel.handle.content().id === next.id) {
      setSelected({ conversation, activeConversationId: conversation.id });
      return;
    }
    const result = layout.openWithSplit(next, {
      preferNewSplit: event?.shiftKey,
      referredFrom: 'agents',
    });
    if (result.status === 'reused' && result.owner !== result.sourceOwner) {
      toast.alert('Content already open');
    }
  };
  const startConversation = (start: StartConversation) => {
    const id = startPendingSession({
      botId: start.botId,
      userId: userId(),
      prompt: start.prompt,
      attachments: start.attachments,
      modelOverride: start.modelOverride,
      repoUrl: start.repoUrl,
      repoBranch: start.repoBranch,
    });
    openConversation(
      { id, type: 'agent_session' },
      undefined,
      modeForKind(kindForBot(start.botId, rosterSource.roster()))
    );
  };
  const adoptSessionId = (placeholderId: string, sessionId: string) => {
    setSelected((current) => {
      if (
        current?.conversation.type !== 'agent_session' ||
        current.conversation.id !== placeholderId ||
        current.activeConversationId === sessionId ||
        panel.handle.content().id !==
          agentsRouteId({
            mode: mode(),
            conversation: current.conversation,
          })
      ) {
        return current;
      }
      panel.handle.adoptContentId({
        type: 'component',
        nextId: agentsRouteId({
          mode: mode(),
          conversation: { type: 'agent_session', id: sessionId },
        }),
      });
      return { ...current, activeConversationId: sessionId };
    });
  };
  const pageTitle = () => {
    if (page() === 'agents') return 'Agents';
    if (page() === 'connections') return 'Connections';
    return 'New conversation';
  };

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <DataModeProvider value={dataMode}>
          <div
            class="agents-view"
            data-agents-workspace={panel.handle.id}
            data-mode={dataMode()}
            data-session={selected() ? '1' : undefined}
          >
            <ViewShell.Root
              asidePreferenceKey="agents"
              class="bg-panel"
              resizable
              aside={{
                min: 224,
                max: 380,
                preserveDuringResize: false,
              }}
              breakpoints={{ collapsed: 0 }}
              layoutBreakpoint="collapsed"
              main={{ min: 280, preferredWidth: 640 }}
            >
              <ViewShell.Aside>
                <AgentsSidebar
                  activePage={selected() ? undefined : page()}
                  onOpenPage={(next) =>
                    next === 'agents' ? openRoster('agent') : openPage(next)
                  }
                  modeForConversation={modeForConversation}
                  activeConversationId={selected()?.activeConversationId}
                  search={search()}
                  groups={groups()}
                  loading={query.isPending}
                  error={query.isLoadingError}
                  hasNextPage={Boolean(query.hasNextPage)}
                  loadingNextPage={query.isFetchingNextPage}
                  onNewConversation={showComposer}
                  onSearchChange={setSearch}
                  onOpenConversation={(conversation, event) =>
                    openConversation(
                      conversation,
                      event,
                      modeForConversation(conversation)
                    )
                  }
                  onRetry={() => void query.refetch()}
                  onLoadMore={() => void query.fetchNextPage()}
                />
              </ViewShell.Aside>

              <ViewShell.Main class="overflow-hidden">
                <main class="main">
                  <Show
                    when={selected()?.conversation}
                    keyed
                    fallback={
                      <>
                        <Topbar title={pageTitle()} />
                        <div class="body">
                          <Suspense fallback={<LoadingComposer />}>
                            <Switch>
                              <Match when={page() === 'connections'}>
                                <McpConnections />
                              </Match>
                              <Match when={page() === 'agents'}>
                                <AgentSettings />
                              </Match>
                              <Match when={true}>
                                <NewChatPage
                                  roster={rosterSource.roster()}
                                  rosterLoading={rosterSource.loading()}
                                  availabilityLoading={rosterSource.availabilityLoading()}
                                  onStart={startConversation}
                                  onOpenRoster={openRoster}
                                />
                              </Match>
                            </Switch>
                          </Suspense>
                        </div>
                      </>
                    }
                  >
                    {(conversation) => (
                      <Switch>
                        <Match when={conversation.type === 'agent_session'}>
                          <Suspense fallback={<LoadingComposer />}>
                            <AgentSessionPane
                              id={conversation.id}
                              notificationSource={notifications}
                              onSessionId={(sessionId) =>
                                adoptSessionId(conversation.id, sessionId)
                              }
                              onDeleted={showComposer}
                            />
                          </Suspense>
                        </Match>
                        <Match when={true}>
                          <div class="body">
                            <Suspense fallback={<LoadingComposer />}>
                              <ChatEmptyStateContext.Provider
                                value={() => (
                                  <div class="px-4 py-16 text-center">
                                    <h2 class="text-[28px] font-medium tracking-[-0.03em] text-ink">
                                      What should we work on?
                                    </h2>
                                  </div>
                                )}
                              >
                                <PreviewPanel
                                  target={previewBlockTarget(conversation)}
                                  orchestrator={orchestrator}
                                  splitPanelContext={panel}
                                  headerLeading={
                                    <SplitPanel.CloseButton class="hidden shrink-0 @max-[720px]/view-shell:flex" />
                                  }
                                />
                              </ChatEmptyStateContext.Provider>
                            </Suspense>
                          </div>
                        </Match>
                      </Switch>
                    )}
                  </Show>
                </main>
              </ViewShell.Main>
            </ViewShell.Root>
          </div>
        </DataModeProvider>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}

/** Dedicated Agents workspace used by the new app views layout. */
export function AgentsView(props: { initialRoute?: AgentsRoute }) {
  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <Suspense fallback={<LoadingComposer />}>
          <AgentsWorkspace initialRoute={props.initialRoute} />
        </Suspense>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}

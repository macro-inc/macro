import { ViewShell } from '@app/components/view-shell';
import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { markAgentSessionNotificationsSeenOnOpen } from '@app/features/block-agent/mark-session-notifications-seen';
import { AgentSettings } from '@app/features/settings/AgentSettings';
import { IntegrationsPage } from '@app/features/settings/IntegrationsPage';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { ViewTour } from '@app/features/tours/ViewTour';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { previewBlockTarget } from '@components/app/previewTarget';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { ChatEmptyStateContext } from '@core/component/AI/component/message/EmptyChatState';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { useWarmAgentSessionQuery } from '@queries/agent-session/warm';
import { useSoupAstItemsQuery } from '@queries/soup/items';
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
import { routineContent } from '../../routines/routine-navigation';
import { RoutinesPage } from '../../routines/routines-page';
import '../agents-view.css';
import { ComposerGreeting } from '@core/component/ComposerGreeting';
import { fireAndForget } from '@core/util/fireAndForget';
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
  partitionArchived,
  selectRecentAgentConversations,
} from '../core/recent-conversations';
import { kindForBot } from '../core/roster';
import { type AgentsRoute, agentsRouteId } from '../core/route';
import { createConversationListView } from '../primitives/conversation-list-view';
import { createWorkspaceMode } from '../primitives/workspace-mode';
import { agentConversationsQuery } from '../queries/agent-conversations-query';
import { createAgentRosterSource } from '../queries/agent-roster-source';
import { agentsTour } from '../tour';
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
  useWarmAgentSessionQuery(userId);
  const notifications = useGlobalNotificationSource();
  const mode = (): AgentsMode => props.initialRoute?.mode ?? 'chat';
  // The composer's Chat/Code choice; an open conversation keeps its own mode.
  const workspace = createWorkspaceMode(userId());
  const listView = createConversationListView(userId());
  const [localPage, setPage] = createSignal<AgentsPage>('new');
  const isRoutinesPage = () => {
    const content = panel.handle.content();
    return content.type === 'component' && content.id === 'routines';
  };
  const page = () => (isRoutinesPage() ? 'routines' : localPage());
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
  const dataMode = () => dataModeFor(selected() ? mode() : workspace.mode());
  const [mobileList, setMobileList] = createSignal(!isRoutinesPage());
  const [draft, setDraft] = createSignal('');
  const [search, setSearch] = createSignal('');
  // Routines that run often leave their runs unlisted; those stay a click
  // away instead of in the list.
  const [showUnlistedRuns, setShowUnlistedRuns] = createSignal(false);
  const rosterSource = createAgentRosterSource();
  const query = useSoupAstItemsQuery(
    () =>
      agentConversationsQuery(userId() ?? '', {
        showUnlistedRuns: showUnlistedRuns(),
      }),
    () => ({ enabled: Boolean(userId()), keepPreviousData: true })
  );
  const conversations = createMemo(() =>
    selectRecentAgentConversations(
      // A pending REST fallback's data read would suspend the sidebar.
      (query.isPending ? [] : (query.data?.entities ?? [])).map((entity) =>
        withEntityNotifications(entity, notifications)
      ),
      userId(),
      search()
    )
  );
  const partitioned = createMemo(() => partitionArchived(conversations()));
  const modeForConversation = (conversation: AgentConversationEntity) =>
    conversationMode(conversation, (botId) =>
      kindForBot(botId, rosterSource.roster())
    );

  onMount(() => panel.handle.setDisplayName('Agents'));

  let composerFocus: (() => void) | undefined;
  const showComposer = () => {
    setMobileList(false);
    if (panel.handle.content().id !== 'agents') {
      panel.handle.replace({ next: { type: 'component', id: 'agents' } });
      return;
    }
    setSelected(undefined);
    setPage('new');
    // The preflight page stays mounted when navigating through management.
    composerFocus?.();
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
        if (!request) return;
        const content = panel.handle.content();
        if (
          content.type === 'component' &&
          typeof content.params?.draft === 'string'
        )
          setDraft(content.params.draft);
        showComposer();
      }
    )
  );
  const openPage = (next: AgentsPage) => {
    setMobileList(false);
    if (next === 'routines') {
      layout.openWithSplit(routineContent(), {
        handle: panel.handle,
        activate: true,
        search: {},
      });
      return;
    }
    if (isRoutinesPage()) {
      layout.openWithSplit(
        {
          type: 'component',
          id: 'agents',
          preserveParams: true,
          params: { agentPage: next, agentPageRequest: crypto.randomUUID() },
        },
        { handle: panel.handle, activate: true, search: {} }
      );
      return;
    }
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
    openPage('agents');
  };
  const openConversation = (
    conversation: AgentConversationTarget,
    event?: MouseEvent,
    targetMode: AgentsMode = mode()
  ) => {
    if (isTouchDevice()) {
      layout.openWithSplit(
        {
          type: conversation.type === 'agent_session' ? 'agent' : 'chat',
          id: conversation.id,
        },
        { referredFrom: 'agents' }
      );
      return;
    }
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
      ...start,
      userId: userId(),
      submitSurface: 'agents',
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
    if (page() === 'routines') return 'Routines';
    if (page() === 'agents') return 'Agents';
    if (page() === 'connections') return 'Integrations';
    return undefined;
  };

  const sidebar = () => (
    <AgentsSidebar
      filters={listView.filters()}
      grouping={listView.grouping()}
      onFilterChange={listView.setSelected}
      onClearFilters={listView.clear}
      onGroupingChange={listView.setGrouping}
      activePage={selected() ? undefined : page()}
      onOpenPage={(next) =>
        next === 'new'
          ? showComposer()
          : next === 'agents'
            ? openRoster('agent')
            : openPage(next)
      }
      modeForConversation={modeForConversation}
      activeConversationId={selected()?.activeConversationId}
      search={search()}
      conversations={partitioned().conversations}
      archived={partitioned().archived}
      loading={query.isPending}
      error={Boolean(query.error) && !query.isFetchNextPageError}
      hasNextPage={Boolean(query.hasNextPage)}
      loadingNextPage={query.isFetchingNextPage}
      onSearchChange={setSearch}
      showUnlistedRuns={showUnlistedRuns()}
      onShowUnlistedRunsChange={setShowUnlistedRuns}
      onOpenConversation={(conversation, event) => {
        markAgentSessionNotificationsSeenOnOpen(conversation, notifications);
        openConversation(
          conversation,
          event,
          modeForConversation(conversation)
        );
      }}
      onRetry={() => fireAndForget(query.refetch(), 'agents-view')}
      onLoadMore={() => fireAndForget(query.fetchNextPage(), 'agents-view')}
    />
  );

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
              main={{ min: 280, preferredWidth: 640 }}
            >
              <Show when={!isTouchDevice()}>
                <ViewShell.Aside>{sidebar()}</ViewShell.Aside>
              </Show>

              <ViewShell.Main class="overflow-hidden">
                <ViewTour tour={agentsTour} />
                <main
                  class="main touch:pt-[calc(var(--safe-top,0px)+0.5rem)]"
                  classList={{ hidden: isTouchDevice() && mobileList() }}
                >
                  <Show
                    when={selected()?.conversation}
                    keyed
                    fallback={
                      <>
                        <Show when={page() !== 'routines'}>
                          <Topbar
                            title={pageTitle()}
                            onBack={
                              isTouchDevice()
                                ? () => setMobileList(true)
                                : undefined
                            }
                          />
                        </Show>
                        <div class="body">
                          <Suspense fallback={<LoadingComposer />}>
                            <Switch>
                              <Match when={page() === 'routines'}>
                                <RoutinesPage />
                              </Match>
                              <Match when={page() === 'connections'}>
                                <IntegrationsPage />
                              </Match>
                              <Match when={page() === 'agents'}>
                                <AgentSettings />
                              </Match>
                            </Switch>
                            <div
                              class="contents"
                              classList={{ hidden: page() !== 'new' }}
                            >
                              <NewChatPage
                                mode={workspace.mode()}
                                onModeChange={workspace.setMode}
                                active={
                                  !isTouchDevice() ||
                                  (!mobileList() && page() === 'new')
                                }
                                registerFocus={(focus) => {
                                  composerFocus = focus;
                                }}
                                workspaceId={panel.handle.id}
                                draft={draft()}
                                onDraftChange={setDraft}
                                roster={rosterSource.roster()}
                                rosterLoading={rosterSource.loading()}
                                availabilityLoading={rosterSource.availabilityLoading()}
                                onStart={startConversation}
                                onOpenRoster={openRoster}
                              />
                            </div>
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
                                    <ComposerGreeting>
                                      What should we work on?
                                    </ComposerGreeting>
                                  </div>
                                )}
                              >
                                <PreviewPanel
                                  target={previewBlockTarget(conversation)}
                                  orchestrator={orchestrator}
                                  splitPanelContext={panel}
                                />
                              </ChatEmptyStateContext.Provider>
                            </Suspense>
                          </div>
                        </Match>
                      </Switch>
                    )}
                  </Show>
                </main>
                <Show when={isTouchDevice() && mobileList()}>
                  <div
                    class="size-full min-h-0 pt-[calc(var(--safe-top,0px)+0.5rem)]"
                    style={{
                      'padding-bottom': `${FloatRegions.hostHeight()}px`,
                    }}
                  >
                    {sidebar()}
                  </div>
                </Show>
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

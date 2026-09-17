import { ViewShell } from '@app/components/view-shell';
import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import {
  type AgentWithHarnessId,
  type CreateAgentParams,
  useCreateAgentMutation,
  useDeleteAgentMutation,
  useUpdateAgentMutation,
} from '@queries/agents/agents';
import { useCursorApiKeyStatusQuery } from '@queries/auth/cursor-api-key';
import {
  useDeleteHarnessMutation,
  useHarnessesQuery,
} from '@queries/harnesses/harnesses';
import { useSoupItemsQuery } from '@queries/soup/items';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { Harness } from '@service-storage/client';
import {
  createMemo,
  createSignal,
  Match,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import '../agents-view.css';
import { AgentSessionPane } from '../components/AgentSessionPane';
import { AgentsSidebar } from '../components/AgentsSidebar';
import { ConfirmDialog } from '../components/SimpleDialogs';
import { Topbar } from '../components/Topbar';
import { DataModeProvider, dataModeFor } from '../context/data-mode';
import { type AgentKind, modeForKind } from '../core/agent-kind';
import type { AgentsMode } from '../core/mode';
import type { AgentsPage } from '../core/pages';
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
import { connectedRuntimes } from '../queries/connected-runtimes';
import { AgentEditorDialog } from './AgentEditorDialog';
import { NewChatPage, type StartConversation } from './NewChatPage';
import { PairRuntimeDialog } from './PairRuntimeDialog';
import { RosterPage } from './RosterPage';

type SelectedConversation = {
  conversation: AgentConversationTarget;
  activeConversationId: string;
};

type EditorState = { agent?: AgentWithHarnessId; kind: AgentKind };

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
  const mode = (): AgentsMode => props.initialRoute?.mode ?? 'chat';
  const dataMode = () => dataModeFor(mode());
  const [page, setPage] = createSignal<AgentsPage>('new');
  const [rosterKind, setRosterKind] = createSignal<AgentKind>('agent');
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
  const [editor, setEditor] = createSignal<EditorState>();
  const [deletingAgent, setDeletingAgent] = createSignal<AgentWithHarnessId>();
  const [pairing, setPairing] = createSignal(false);
  const [removingRuntime, setRemovingRuntime] = createSignal<Harness>();

  const rosterSource = createAgentRosterSource();
  const harnessesQuery = useHarnessesQuery();
  const cursorStatus = useCursorApiKeyStatusQuery();
  const currentTeamQuery = useCurrentTeamQuery();
  const createAgent = useCreateAgentMutation();
  const updateAgent = useUpdateAgentMutation();
  const deleteAgent = useDeleteAgentMutation();
  const deleteHarness = useDeleteHarnessMutation();
  const cursorConnected = () =>
    cursorStatus.isSuccess ? cursorStatus.data.registered : false;
  const runtimes = () =>
    connectedRuntimes(
      cursorConnected(),
      harnessesQuery.isSuccess ? harnessesQuery.data : []
    );
  const currentTeamId = () =>
    currentTeamQuery.isSuccess ? currentTeamQuery.data?.team.id : undefined;

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
      query.isSuccess ? query.data : [],
      userId(),
      search()
    )
  );
  const groups = createMemo(() => groupConversations(conversations()));
  const modeForConversation = (conversation: AgentConversationEntity) =>
    conversationMode(conversation, (botId) =>
      kindForBot(botId, rosterSource.roster())
    );
  const handleForBot = (botId: string | undefined) =>
    botId
      ? rosterSource.roster().find((agent) => agent.botId === botId)?.handle
      : undefined;

  onMount(() => panel.handle.setDisplayName('Agents'));

  const showComposer = () => {
    if (panel.handle.content().id !== 'agents') {
      panel.handle.replace({ next: { type: 'component', id: 'agents' } });
      return;
    }
    setSelected(undefined);
    setPage('new');
  };
  const openRoster = (kind: AgentKind) => {
    setSelected(undefined);
    setRosterKind(kind);
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
    if (event?.shiftKey) {
      layout.openWithSplit(next, {
        preferNewSplit: true,
        referredFrom: 'agents',
      });
      return;
    }
    if (panel.handle.content().id === next.id) return;
    panel.handle.replace({ next, referredFrom: 'agents' });
  };
  const startConversation = (start: StartConversation) => {
    const id = startPendingSession({
      botId: start.botId,
      prompt: start.prompt,
      modelOverride: start.modelOverride,
      repoUrl: start.repoUrl,
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
  const saveAgent = async (params: CreateAgentParams): Promise<boolean> => {
    const current = editor();
    try {
      if (current?.agent) {
        await updateAgent.mutateAsync({
          ...params,
          agentId: current.agent.bot.id,
          ...(current.agent.bot.description
            ? { description: current.agent.bot.description }
            : {}),
        });
        toast.success('Agent updated');
      } else {
        await createAgent.mutateAsync(params);
        toast.success('Agent created');
      }
      return true;
    } catch {
      toast.failure(
        current?.agent ? 'Failed to update agent' : 'Failed to create agent'
      );
      return false;
    }
  };
  const removeAgent = async () => {
    const current = deletingAgent();
    if (!current) return;
    try {
      await deleteAgent.mutateAsync({
        agentId: current.bot.id,
        channelIds: current.channel_ids,
      });
      setDeletingAgent(undefined);
      setEditor(undefined);
      toast.success('Agent deleted');
    } catch {
      toast.failure('Failed to delete agent');
    }
  };
  const removeRuntime = async () => {
    const current = removingRuntime();
    if (!current) return;
    try {
      await deleteHarness.mutateAsync({ harnessId: current.id });
      setRemovingRuntime(undefined);
      toast.success('Runtime removed');
    } catch {
      toast.failure('Failed to remove runtime');
    }
  };

  const pageTitle = () => {
    if (page() === 'agents') return 'Agents';
    return 'New conversation';
  };

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <DataModeProvider value={dataMode}>
          <div
            class="agents-view"
            data-mode={dataMode()}
            data-session={selected() ? '1' : undefined}
          >
            <ViewShell.Root
              asidePreferenceKey="agents"
              resizable
              aside={{
                width: 280,
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
                  modeForConversation={modeForConversation}
                  activeConversationId={selected()?.activeConversationId}
                  search={search()}
                  groups={groups()}
                  loading={query.isPending}
                  error={query.isLoadingError}
                  hasNextPage={Boolean(query.hasNextPage)}
                  loadingNextPage={query.isFetchingNextPage}
                  handleForBot={handleForBot}
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
                              <Match when={page() === 'agents'}>
                                <RosterPage
                                  kind={rosterKind()}
                                  onKindChange={setRosterKind}
                                  onClose={showComposer}
                                  onCreate={(kind) => setEditor({ kind })}
                                  onEdit={(agent) =>
                                    setEditor({
                                      agent,
                                      kind:
                                        agent.harness === 'in-memory'
                                          ? 'agent'
                                          : 'coder',
                                    })
                                  }
                                  onDelete={setDeletingAgent}
                                  onPairRuntime={() => setPairing(true)}
                                  onRemoveRuntime={setRemovingRuntime}
                                />
                              </Match>
                              <Match when={true}>
                                <NewChatPage
                                  roster={rosterSource.roster()}
                                  rosterLoading={rosterSource.loading()}
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
                              mode={mode()}
                              roster={rosterSource.roster()}
                              onSessionId={(sessionId) =>
                                adoptSessionId(conversation.id, sessionId)
                              }
                              onDeleted={showComposer}
                            />
                          </Suspense>
                        </Match>
                        <Match when={true}>
                          <Topbar title="Chat" />
                          <div class="body">
                            <Suspense fallback={<LoadingComposer />}>
                              <PreviewPanel
                                selectedEntity={conversation}
                                orchestrator={orchestrator}
                                splitPanelContext={panel}
                              />
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

          <Show when={editor()} keyed>
            {(state) => (
              <AgentEditorDialog
                agent={state.agent}
                initialKind={state.kind}
                runtimes={runtimes()}
                currentTeamId={currentTeamId()}
                canShareWithTeam={currentTeamId() !== undefined}
                canMakePrivate={
                  state.agent?.bot.owner?.type !== 'team' ||
                  state.agent.bot.created_by === userId()
                }
                pending={createAgent.isPending || updateAgent.isPending}
                onClose={() => setEditor(undefined)}
                onSave={saveAgent}
                onDelete={
                  state.agent ? () => setDeletingAgent(state.agent) : undefined
                }
              />
            )}
          </Show>
          <Show when={deletingAgent()} keyed>
            {(agent) => (
              <ConfirmDialog
                title={`Delete ${agent.bot.name}?`}
                body="This removes the agent from every channel and permanently deletes its configuration. This action cannot be undone."
                confirmLabel="Delete agent"
                pendingLabel="Deleting…"
                danger
                pending={deleteAgent.isPending}
                onConfirm={() => void removeAgent()}
                onClose={() => setDeletingAgent(undefined)}
              />
            )}
          </Show>
          <Show when={pairing()}>
            <PairRuntimeDialog onClose={() => setPairing(false)} />
          </Show>
          <Show when={removingRuntime()} keyed>
            {(harness) => (
              <ConfirmDialog
                title={`Remove ${harness.name}?`}
                body="Agents using this runtime will stop running until it is reconnected. macrod on that machine will need to pair again."
                confirmLabel="Remove runtime"
                pendingLabel="Removing…"
                danger
                pending={deleteHarness.isPending}
                onConfirm={() => void removeRuntime()}
                onClose={() => setRemovingRuntime(undefined)}
              />
            )}
          </Show>
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

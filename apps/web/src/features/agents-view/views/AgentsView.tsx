import { ViewShell } from '@app/components/view-shell';
import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { HomeChatInput } from '@app/features/home/home-chat-input';
import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { Agents } from '@app/features/settings/Agents';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { ChatInputProvider } from '@core/component/AI/context';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useUserId } from '@core/context/user';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { useSoupItemsQuery } from '@queries/soup/items';
import {
  createMemo,
  createSignal,
  Match,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { AgentSessionPane } from '../components/AgentSessionPane';
import { AgentsSidebar } from '../components/AgentsSidebar';
import type { AgentKind } from '../core/agent-kind';
import type { AgentsMode } from '../core/mode';
import type { AgentsPage } from '../core/pages';
import {
  type AgentConversationTarget,
  conversationsForMode,
  groupConversations,
  selectRecentAgentConversations,
} from '../core/recent-conversations';
import { kindForBot } from '../core/roster';
import { createAgentsMode } from '../primitives/agents-mode';
import { createAgentRosterSource } from '../queries/agent-roster-source';
import {
  NewConversationView,
  type StartConversation,
} from './NewConversationView';

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

function AgentsWorkspace() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const userId = useUserId();
  const agentsFlag = useFeatureFlag(enableChatV3Agents);
  // Code mode hands work to coders through the agent-session composer, so
  // without that flag the workspace is the Chat half only.
  const modeSwitch = () => agentsFlag().enabled;
  const modeState = createAgentsMode(userId());
  const mode = (): AgentsMode => (modeSwitch() ? modeState.mode() : 'chat');
  const [page, setPage] = createSignal<AgentsPage>('new');
  const [rosterKind, setRosterKind] = createSignal<AgentKind>('agent');
  const [selected, setSelected] = createSignal<SelectedConversation>();
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
      query.isSuccess ? query.data : [],
      userId(),
      search()
    )
  );
  const modeConversations = createMemo(() =>
    conversationsForMode(conversations(), mode(), (botId) =>
      kindForBot(botId, rosterSource.roster())
    )
  );
  const groups = createMemo(() =>
    groupConversations(modeConversations(), mode())
  );

  onMount(() => panel.handle.setDisplayName('Agents'));

  const showComposer = () => {
    setSelected(undefined);
    setPage('new');
  };

  const changeMode = (next: AgentsMode) => {
    modeState.setMode(next);
    showComposer();
  };

  const openRoster = (kind: AgentKind) => {
    setSelected(undefined);
    setRosterKind(kind);
    setPage('agents');
  };

  const openConversation = (conversation: AgentConversationTarget) => {
    setPage('new');
    setSelected({
      conversation: { id: conversation.id, type: conversation.type },
      activeConversationId: conversation.id,
    });
  };

  const startConversation = (start: StartConversation) => {
    const id = startPendingSession({
      botId: start.botId,
      prompt: start.prompt,
      modelOverride: start.modelOverride,
      repoUrl: start.repoUrl,
    });
    openConversation({ id, type: 'agent_session' });
  };

  const adoptSessionId = (placeholderId: string, sessionId: string) => {
    setSelected((current) => {
      if (
        current?.conversation.type !== 'agent_session' ||
        current.conversation.id !== placeholderId
      ) {
        return current;
      }
      return { ...current, activeConversationId: sessionId };
    });
  };

  const pageTitle = () => {
    if (page() === 'agents') return 'Agents';
    return mode() === 'code' ? 'New session' : 'New chat';
  };

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ViewShell.Root
          asidePreferenceKey="agents"
          class="bg-panel"
          resizable
          aside={{
            width: 320,
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
              mode={mode()}
              modeSwitch={modeSwitch()}
              activeConversationId={selected()?.activeConversationId}
              search={search()}
              groups={groups()}
              loading={query.isPending}
              error={query.isLoadingError}
              hasNextPage={Boolean(query.hasNextPage)}
              loadingNextPage={query.isFetchingNextPage}
              loadMoreError={query.isFetchNextPageError}
              onModeChange={changeMode}
              onNewConversation={showComposer}
              onSearchChange={setSearch}
              onOpenConversation={openConversation}
              onRetry={() => void query.refetch()}
              onLoadMore={() => void query.fetchNextPage()}
            />
          </ViewShell.Aside>

          <ViewShell.Main class="overflow-hidden">
            <Show
              when={selected()?.conversation}
              keyed
              fallback={
                <>
                  <ViewShell.TopBar>{pageTitle()}</ViewShell.TopBar>
                  <div class="min-h-0 flex-1">
                    <Suspense fallback={<LoadingComposer />}>
                      <Switch>
                        <Match when={page() === 'new'}>
                          <Switch>
                            <Match when={agentsFlag().loading}>
                              <LoadingComposer />
                            </Match>
                            <Match when={agentsFlag().enabled}>
                              <NewConversationView
                                mode={mode()}
                                roster={rosterSource.roster()}
                                rosterLoading={rosterSource.loading()}
                                rosterError={rosterSource.error()}
                                conversations={conversations()}
                                onStart={startConversation}
                                onOpenRoster={openRoster}
                              />
                            </Match>
                            <Match when={true}>
                              <div class="flex size-full items-center justify-center px-6 pb-16">
                                <div class="w-full max-w-2xl">
                                  <ChatInputProvider>
                                    <HomeChatInput />
                                  </ChatInputProvider>
                                </div>
                              </div>
                            </Match>
                          </Switch>
                        </Match>
                        <Match when={page() === 'agents'}>
                          <Agents
                            initialKind={rosterKind()}
                            onClose={showComposer}
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
                    <Suspense>
                      <AgentSessionPane
                        id={conversation.id}
                        mode={mode()}
                        onSessionId={(sessionId) =>
                          adoptSessionId(conversation.id, sessionId)
                        }
                      />
                    </Suspense>
                  </Match>
                  <Match when={true}>
                    <Suspense>
                      <PreviewPanel
                        selectedEntity={conversation}
                        orchestrator={orchestrator}
                        splitPanelContext={panel}
                      />
                    </Suspense>
                  </Match>
                </Switch>
              )}
            </Show>
          </ViewShell.Main>
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}

/** Dedicated Agents workspace used by the new app views layout. */
export function AgentsView() {
  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <Suspense fallback={<LoadingComposer />}>
          <AgentsWorkspace />
        </Suspense>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}

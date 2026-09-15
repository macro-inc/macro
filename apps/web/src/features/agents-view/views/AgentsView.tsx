import { ViewShell } from '@app/components/view-shell';
import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { AgentInput } from '@app/features/block-agent/ui';
import { HomeChatInput } from '@app/features/home/home';
import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { Agents } from '@app/features/settings/Agents';
import { ConnectedAccounts } from '@app/features/settings/ConnectedAccounts';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { ChatInputProvider } from '@core/component/AI/context';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { enableChatV3Agents } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { useSoupItemsQuery } from '@queries/soup/items';
import { createSignal, Match, onMount, Show, Suspense, Switch } from 'solid-js';
import { AgentResourceList } from '../components/AgentResourceList';
import { AgentSessionPane } from '../components/AgentSessionPane';
import { AgentsSidebar } from '../components/AgentsSidebar';
import type { AgentsPage } from '../core/pages';
import {
  type AgentConversationTarget,
  selectRecentAgentConversations,
} from '../core/recent-conversations';

const PAGE_TITLES: Record<AgentsPage, string> = {
  new: 'New Chat',
  routines: 'Routines',
  agents: 'Agents',
  connections: 'Connections',
  skills: 'Skills',
};

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
  const layout = useSplitLayout();

  const orchestrator = useGlobalBlockOrchestrator();
  const userId = useUserId();

  const agentsFlag = useFeatureFlag(enableChatV3Agents);

  const [page, setPage] = createSignal<AgentsPage>('new');
  const [selected, setSelected] = createSignal<SelectedConversation>();
  const [search, setSearch] = createSignal('');

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

  const conversations = () =>
    selectRecentAgentConversations(
      query.isSuccess ? query.data : [],
      userId(),
      search()
    );

  onMount(() => panel.handle.setDisplayName('Agents'));

  const navigate = (next: AgentsPage) => {
    setSelected(undefined);
    setPage(next);
  };

  const openConversation = (
    conversation: AgentConversationTarget,
    event?: MouseEvent
  ) => {
    if (event?.shiftKey) {
      layout.openWithSplit(
        {
          type: conversation.type === 'agent_session' ? 'agent' : 'chat',
          id: conversation.id,
        },
        { preferNewSplit: true, referredFrom: 'agents' }
      );
      return;
    }

    setPage('new');
    setSelected({
      conversation: { id: conversation.id, type: conversation.type },
      activeConversationId: conversation.id,
    });
  };

  const startSession = (prompt: string) => {
    const id = startPendingSession({ prompt });
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

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ViewShell.Root
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
              page={page()}
              activeConversationId={selected()?.activeConversationId}
              search={search()}
              conversations={conversations()}
              loading={query.isPending}
              error={query.isLoadingError}
              hasNextPage={Boolean(query.hasNextPage)}
              loadingNextPage={query.isFetchingNextPage}
              loadMoreError={query.isFetchNextPageError}
              onNavigate={navigate}
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
                  <ViewShell.TopBar>{PAGE_TITLES[page()]}</ViewShell.TopBar>
                  <div class="min-h-0 flex-1">
                    <Suspense fallback={<LoadingComposer />}>
                      <Switch>
                        <Match when={page() === 'new'}>
                          <div class="flex size-full items-center justify-center px-6 pb-16">
                            <div class="w-full max-w-2xl">
                              <Switch>
                                <Match when={agentsFlag().loading}>
                                  <LoadingComposer />
                                </Match>
                                <Match when={agentsFlag().enabled}>
                                  <AgentInput
                                    autofocus
                                    placeholder="Message the agent, @mention anything"
                                    onSend={startSession}
                                  />
                                </Match>
                                <Match when={true}>
                                  <ChatInputProvider>
                                    <HomeChatInput />
                                  </ChatInputProvider>
                                </Match>
                              </Switch>
                            </div>
                          </div>
                        </Match>
                        <Match when={page() === 'routines'}>
                          <AgentResourceList page="routines" />
                        </Match>
                        <Match when={page() === 'agents'}>
                          <Agents />
                        </Match>
                        <Match when={page() === 'connections'}>
                          <ConnectedAccounts />
                        </Match>
                        <Match when={page() === 'skills'}>
                          <AgentResourceList page="skills" />
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

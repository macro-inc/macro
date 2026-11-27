import { ViewShell } from '@app/components/view-shell';
import { useInlinePreviewLayout } from '@app/components/view-shell/use-inline-preview-layout';
import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { AgentSettings } from '@app/features/settings/AgentSettings';
import { IntegrationsPage } from '@app/features/settings/IntegrationsPage';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { ViewTour } from '@app/features/tours/ViewTour';
import { TutorialPill } from '@app/features/video-tutorials';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { previewBlockTarget } from '@components/app/previewTarget';
import { useEntryState } from '@components/app/split-layout/entry-state';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { ChatEmptyStateContext } from '@core/component/AI/component/message/EmptyChatState';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import { markRowNotificationsSeenOnOpen } from '@notifications/mark-row-seen';
import { useWarmAgentSessionQuery } from '@queries/agent-session/warm';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  on,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import {
  routineContent,
  routineIdFromContent,
} from '../../routines/routine-navigation';
import { RoutinesPage } from '../../routines/routines-page';
import '../agents-view.css';

import { changeSessionArchiveState } from '@app/features/block-agent/queries/change-session-archive-state';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import {
  beginInteraction,
  TraceFlow,
  usePending,
} from '@app/observability/flow';
import { ComposerGreeting } from '@core/component/ComposerGreeting';
import { enableAgentUpdates } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { writeClipboardData } from '@core/util/dataTransfer';
import { fireAndForget } from '@core/util/fireAndForget';
import { openExternalUrl } from '@core/util/url';
import type { AgentSessionEntity } from '@entity';
import { Telemetry } from '@macro-inc/observability';
import {
  AGENTS_ARCHIVE_VIEW_ID,
  agentsArchiveContent,
} from '../archive-navigation';
import { AgentSessionPane } from '../components/AgentSessionPane';
import { AgentSessionSkeleton } from '../components/AgentSessionSkeleton';
import { AgentsSidebar } from '../components/AgentsSidebar';
import { Topbar } from '../components/Topbar';
import type { ConversationActions } from '../context/conversation-actions';
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
import { PhoneAgentsList } from '../phone-list';
import { PhoneAgentsSidebar } from '../phone-sidebar';
import { createPersistedComposerDraft } from '../primitives/composer-draft';
import { createConversationListView } from '../primitives/conversation-list-view';
import { useWorkspaceDrawerEntry } from '../primitives/drawer-navigation';
import { mobileAgentRequest } from '../primitives/mobile-agent-request';
import { createWorkspaceMode } from '../primitives/workspace-mode';
import { agentConversationsQuery } from '../queries/agent-conversations-query';
import { createAgentRosterSource } from '../queries/agent-roster-source';
import { agentsTour } from '../tour';
import { DesktopAgentsSidebar } from './agents-sidebar/agents-sidebar';
import { ArchivedConversations } from './archived-conversations/archived-conversations';
import {
  type AgentRequest,
  NewChatPage,
  type StartConversation,
} from './NewChatPage';

type SelectedConversation = {
  conversation: AgentConversationTarget;
  activeConversationId: string;
};

/** Entry-state slice holding the composer request whose draft was seeded. */
const SEEDED_COMPOSER_REQUEST = 'agents.seededComposerRequest';

function LoadingComposer() {
  return (
    <div class="grid size-full place-items-center text-ink-muted">
      <SpinnerIcon
        aria-hidden={false}
        aria-label="Loading agent composer"
        class="size-5 animate-spin"
      />
    </div>
  );
}

function AgentsMobileList(props: { children: JSX.Element }) {
  return (
    <div
      class="size-full min-h-0"
      style={{ 'padding-bottom': `${FloatRegions.hostHeight()}px` }}
    >
      {props.children}
    </div>
  );
}

function AgentsWorkspace(props: { route?: AgentsRoute }) {
  const panel = useSplitPanelOrThrow();
  const fromWorkspaceDrawer = useWorkspaceDrawerEntry();
  const inlinePreviewLayout = useInlinePreviewLayout();
  const mobileLayout = () => !inlinePreviewLayout();
  const layout = useSplitLayout();
  const orchestrator = useGlobalBlockOrchestrator();
  const userId = useUserId();
  const updatesFlag = useFeatureFlag(enableAgentUpdates);
  useWarmAgentSessionQuery(userId);
  const notifications = useGlobalNotificationSource();
  const mode = (): AgentsMode => props.route?.mode ?? 'chat';
  // The composer's Auto/Chat/Code choice; an open conversation keeps its own mode.
  const workspace = createWorkspaceMode();
  // A coding agent another surface asked the composer to start with.
  const [requestedAgent, setRequestedAgent] = createSignal<AgentRequest>();
  const listView = createConversationListView(userId());
  const archivedListView = createConversationListView(
    userId(),
    'agents-archived-list-view-v1'
  );
  const phoneListView = () =>
    page() === 'archived' ? archivedListView : listView;
  const conversationSort = () =>
    isTouchDevice() ? ('updated' as const) : listView.sort();
  const [creatingKind, setCreatingKind] = createSignal<AgentKind>();
  const [localPage, setPage] = createSignal<AgentsPage>('new');
  const routedPage = () => {
    const content = panel.handle.content();
    if (content.type !== 'component') return;
    if (content.id === 'routines') return 'routines';
    if (content.id === AGENTS_ARCHIVE_VIEW_ID) return 'archived';
  };
  const page = () => routedPage() ?? localPage();
  const [selected, setSelected] = createSignal<
    SelectedConversation | undefined
  >(
    props.route
      ? {
          conversation: props.route.conversation,
          activeConversationId: props.route.conversation.id,
        }
      : undefined
  );
  // Selecting takes effect at once: the conversation's own Suspense shows a
  // skeleton until its first load resolves. Selecting the conversation already
  // on screen keeps it mounted, since the keyed Show remounts on a new object.
  const selectConversation = (conversation: AgentConversationTarget) =>
    batch(() => {
      setPage('new');
      setMobileList(false);
      setSelected((current) =>
        current?.activeConversationId === conversation.id
          ? current
          : { conversation, activeConversationId: conversation.id }
      );
    });
  // The list and its conversations share one mount (`mountKey` in the routes),
  // so the selection follows navigation, including Back and Forward.
  createEffect(
    on(
      () => {
        const conversation = props.route?.conversation;
        return conversation && `${conversation.type}:${conversation.id}`;
      },
      () => {
        const conversation = props.route?.conversation;
        if (!conversation) {
          setSelected(undefined);
          return;
        }
        // An adopted session id is the conversation already on screen.
        if (selected()?.activeConversationId === conversation.id) return;
        selectConversation(conversation);
      },
      { defer: true }
    )
  );
  const dataMode = () => dataModeFor(selected() ? mode() : workspace.mode());
  const [mobileList, setMobileList] = createSignal(
    routedPage() !== 'routines' && !props.route
  );
  const persistedDraft = createPersistedComposerDraft(undefined, userId);
  const [search, setSearch] = createSignal('');
  const [archivedSearch, setArchivedSearch] = createSignal('');
  // Routines that run often leave their runs unlisted; those stay a click
  // away instead of in the list.
  const [showUnlistedRuns, setShowUnlistedRuns] = createSignal(false);
  const rosterSource = createAgentRosterSource();
  const query = useSoupAstItemsQuery(
    () =>
      agentConversationsQuery(userId() ?? '', {
        showUnlistedRuns: showUnlistedRuns(),
        sort: conversationSort(),
      }),
    () => ({ enabled: Boolean(userId()), keepPreviousData: true })
  );
  usePending('agents.conversations', () => query.isPending);
  const allConversations = createMemo(() =>
    selectRecentAgentConversations(
      // A pending REST fallback's data read would suspend the sidebar.
      (query.isPending ? [] : (query.data?.entities ?? [])).map((entity) =>
        withEntityNotifications(entity, notifications)
      ),
      userId(),
      '',
      conversationSort()
    )
  );
  const conversations = createMemo(() =>
    selectRecentAgentConversations(
      allConversations(),
      userId(),
      search(),
      conversationSort()
    )
  );
  const allArchived = createMemo(
    () => partitionArchived(allConversations()).archived
  );
  const partitioned = createMemo(() => partitionArchived(conversations()));
  const updateSessions = () =>
    (query.isPending ? [] : (query.data?.entities ?? [])).filter(
      (entity): entity is AgentSessionEntity => entity.type === 'agent_session'
    );
  const modeForConversation = (conversation: AgentConversationEntity) =>
    conversationMode(conversation, (botId) =>
      kindForBot(botId, rosterSource.roster())
    );

  onMount(() => panel.handle.setDisplayName('Agents'));

  let composerFocus: (() => void) | undefined;
  const showComposer = () => {
    setMobileList(false);
    if (mobileLayout() && page() !== 'new') {
      panel.handle.replace({ next: { type: 'component', id: 'agents' } });
      return;
    }
    if (panel.handle.content().id !== 'agents') {
      panel.handle.replace({ next: { type: 'component', id: 'agents' } });
      return;
    }
    setSelected(undefined);
    setPage('new');
    // The preflight page stays mounted when navigating through management.
    composerFocus?.();
  };
  // A composer request's draft seeds the composer once. Its entry keeps the
  // request, so Back, Forward and resuming this view deliver it again; the
  // entry records the seeded request so a sent draft does not come back.
  const [, setSeededRequest] = useEntryState<string | undefined>(
    SEEDED_COMPOSER_REQUEST,
    { default: undefined }
  );
  // A launcher navigation can target this already-mounted workspace.
  createEffect(
    on(
      () => {
        const content = panel.handle.content();
        return content.type === 'component'
          ? content.params?.focusComposer
          : undefined;
      },
      (request, previous) => {
        if (typeof request !== 'string' || !request || request === previous)
          return;
        const content = panel.handle.content();
        const draft =
          content.type === 'component' ? content.params?.draft : undefined;
        const seeded =
          panel.handle.currentEntryState()?.[SEEDED_COMPOSER_REQUEST];
        // The workspace stays mounted across entries, so the captured slice
        // must follow the request of the entry now shown.
        setSeededRequest(request);
        if (
          request !== seeded &&
          typeof draft === 'string' &&
          draft.length > 0
        ) {
          persistedDraft.setDraft(draft);
          // Record it now: a stacked phone pane can unmount without leaving
          // this entry, which is when entry state is otherwise captured.
          panel.handle.captureEntryState();
        }
        if (mobileLayout() && content.id === 'agents') {
          setSelected(undefined);
          setPage('new');
          setMobileList(false);
          composerFocus?.();
        } else showComposer();
      }
    )
  );
  const openPage = (
    next: AgentsPage,
    createKind?: AgentKind,
    navigationSource?: 'agents'
  ) => {
    setCreatingKind(createKind);
    setMobileList(false);
    if (next === 'archived') {
      layout.openWithSplit(agentsArchiveContent(), {
        handle: panel.handle,
        activate: true,
        search: {},
        referredFrom: navigationSource,
      });
      return;
    }
    if (next === 'routines') {
      layout.openWithSplit(routineContent(), {
        handle: panel.handle,
        activate: true,
        search: {},
        referredFrom: navigationSource,
      });
      return;
    }
    if (mobileLayout()) {
      panel.handle.replace({
        referredFrom: navigationSource,
        next: {
          type: 'component',
          id: 'agents',
          preserveParams: true,
          params: {
            agentPage: next,
            agentPageRequest: crypto.randomUUID(),
            createAgentKind: createKind,
            // A drawer destination replaces a one-shot composer intent, not its draft store.
            focusComposer: undefined,
            composerAgentId: undefined,
            draft: undefined,
          },
        },
      });
      return;
    }
    if (routedPage()) {
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
  // A history entry owns the mobile page. Restoring it never opens a new entry.
  createEffect(
    on(
      () => panel.handle.content(),
      (content) => {
        if (!mobileLayout()) return;
        const next =
          content.type === 'component' && content.id === 'routines'
            ? 'routines'
            : content.type === 'component' &&
                content.id === AGENTS_ARCHIVE_VIEW_ID
              ? 'archived'
              : content.type === 'component' && content.id === 'agents'
                ? (parseAgentsPage(content.params?.agentPage) ?? 'new')
                : 'new';
        setSelected(undefined);
        setPage(next);
        setMobileList(
          next === 'new' &&
            !(content.type === 'component' && content.params?.focusComposer)
        );
        const createKind =
          content.type === 'component' && next === 'agents'
            ? content.params?.createAgentKind
            : undefined;
        setCreatingKind(
          createKind === 'agent' || createKind === 'coder'
            ? createKind
            : undefined
        );
        if (next === 'new' && content.type === 'component') {
          const agent = content.params?.composerAgentId;
          const request = content.params?.agentPageRequest;
          if (typeof agent === 'string' && typeof request === 'string') {
            workspace.setMode('code');
            setRequestedAgent({ agentId: agent, request });
            setMobileList(false);
          }
        }
      }
    )
  );
  createEffect(
    on(
      () => {
        const content = panel.handle.content();
        return content.type === 'component'
          ? content.params?.agentPageRequest
          : undefined;
      },
      () => {
        if (mobileLayout()) return;
        const content = panel.handle.content();
        if (content.type !== 'component') return;
        const next = parseAgentsPage(content.params?.agentPage);
        const agent = content.params?.composerAgentId;
        const request = content.params?.agentPageRequest;
        if (
          next === 'new' &&
          typeof agent === 'string' &&
          typeof request === 'string'
        ) {
          workspace.setMode('code');
          setRequestedAgent({ agentId: agent, request });
        }
        if (next) openPage(next);
      }
    )
  );
  const openRoster = (_kind: AgentKind) => {
    openPage('agents');
  };
  const openConversation = (
    conversation: AgentConversationTarget,
    newSplit = false,
    targetMode: AgentsMode = mode()
  ) => {
    if (mobileLayout()) {
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
    if (!newSplit && panel.handle.content().id === next.id) {
      selectConversation(conversation);
      return;
    }
    const result = layout.openWithSplit(next, {
      preferNewSplit: newSplit,
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
      false,
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
  const backToPreviousPage = () => {
    if (panel.handle.canGoBack()) panel.handle.goBack();
    else
      panel.handle.replace({
        next: { type: 'component', id: 'agents' },
        mergeHistory: true,
      });
  };
  const pageTitle = () => {
    if (page() === 'routines') return 'Routines';
    if (page() === 'agents') return 'Agents';
    if (page() === 'connections') return 'Integrations';
    if (page() === 'archived') return t('viewMenus.archived');
    return undefined;
  };

  const openListedConversation = (
    conversation: AgentConversationEntity,
    event?: MouseEvent
  ) => {
    markRowNotificationsSeenOnOpen(conversation, notifications);
    openConversation(
      conversation,
      event?.shiftKey ?? false,
      modeForConversation(conversation)
    );
  };
  const actions: ConversationActions = {
    openPullRequest: (pr, event) => {
      if (pr.id) {
        layout.openWithSplit(
          { type: 'pr', id: pr.id },
          { preferNewSplit: event.shiftKey, referredFrom: 'agents' }
        );
      } else {
        openExternalUrl(pr.url);
      }
    },
    openBranch: openExternalUrl,
    copyBranch: async (branch) => {
      const copied = await writeClipboardData({ 'text/plain': branch });
      if (!copied)
        toast.failure(t('entityActions.toastCopyFailed', { count: 1 }));
      return copied;
    },
    unarchive: (id) =>
      Telemetry.span('agents.unarchive', async (span) => {
        span.setAttr('session.id', id);
        const success = await changeSessionArchiveState(id, false);
        if (!success) span.error('Unable to unarchive session');
        return success;
      }),
  };
  const openSidebarPage = (next: AgentsPage) => {
    if (next === 'new') {
      showComposer();
      return;
    }
    if (next === 'agents') {
      openRoster('agent');
      return;
    }
    const interaction = beginInteraction('agents.page.open');
    try {
      openPage(next);
    } finally {
      interaction.end();
    }
  };
  const desktopSidebar = () => (
    <DesktopAgentsSidebar
      ownerId={userId()}
      sort={conversationSort()}
      onSortChange={(sort) => {
        const interaction = beginInteraction('agents.conversations.sort');
        try {
          listView.setSort(sort);
        } finally {
          interaction.end();
        }
      }}
      filters={listView.filters()}
      onFilterChange={listView.setSelected}
      onClearFilters={listView.clear}
      activePage={selected() ? undefined : page()}
      onOpenPage={openSidebarPage}
      onCreateAgent={(kind) => {
        openPage('agents');
        setCreatingKind(kind);
      }}
      onCreateRoutine={() =>
        layout.popoverSplit({ type: 'component', id: 'routine-compose' })
      }
      modeForConversation={modeForConversation}
      activeConversationId={selected()?.activeConversationId}
      search={search()}
      onSearchChange={setSearch}
      conversations={partitioned().conversations}
      archived={partitioned().archived}
      loading={query.isPending}
      error={Boolean(query.error)}
      hasNextPage={Boolean(query.hasNextPage)}
      loadingNextPage={query.isFetchingNextPage}
      showOpenPullRequests={updatesFlag().enabled}
      showUnlistedRuns={showUnlistedRuns()}
      onShowUnlistedRunsChange={setShowUnlistedRuns}
      onOpenConversation={openListedConversation}
      onRetry={() =>
        fireAndForget(
          query.isFetchNextPageError ? query.fetchNextPage() : query.refetch(),
          'agents-view'
        )
      }
      onLoadMore={() => fireAndForget(query.fetchNextPage(), 'agents-view')}
      actions={actions}
    />
  );

  const sidebar = () => (
    <AgentsSidebar
      filters={listView.filters()}
      grouping={listView.grouping()}
      onFilterChange={listView.setSelected}
      onClearFilters={listView.clear}
      onGroupingChange={listView.setGrouping}
      activePage={selected() ? undefined : page()}
      onCreateRoutine={() =>
        layout.popoverSplit({ type: 'component', id: 'routine-compose' })
      }
      onCreateAgent={(kind) => {
        openPage('agents');
        setCreatingKind(kind);
      }}
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
      onOpenConversation={(conversation, newSplit) => {
        markRowNotificationsSeenOnOpen(conversation, notifications);
        openConversation(
          conversation,
          newSplit,
          modeForConversation(conversation)
        );
      }}
      onRetry={() => fireAndForget(query.refetch(), 'agents-view')}
      onLoadMore={() => fireAndForget(query.fetchNextPage(), 'agents-view')}
    />
  );

  return (
    <DataModeProvider value={dataMode}>
      <div
        class="agents-view agents-scope"
        data-agents-workspace={panel.handle.id}
        data-mode={dataMode()}
        data-session={selected() ? '1' : undefined}
      >
        <ViewShell.Root
          contentLayout="collection"
          asidePreferenceKey="agents"
          class="bg-panel"
          resizable
          aside={{ min: 224, max: 380, preserveDuringResize: false }}
          main={{ min: 280, preferredWidth: 640 }}
        >
          <ViewShell.Aside>
            <Switch>
              <Match when={isTouchDevice() && mobileLayout()}>
                <PhoneAgentsSidebar
                  activePage={page()}
                  activeRoutineId={routineIdFromContent(panel.handle.content())}
                  archivedCount={
                    !query.hasNextPage && !query.isPending && !query.error
                      ? allArchived().length
                      : undefined
                  }
                  onOpenPage={(next) => {
                    const interaction = beginInteraction('agents.page.open');
                    try {
                      openPage(next, undefined, 'agents');
                    } finally {
                      interaction.end();
                    }
                  }}
                  onCreateAgent={() => openPage('agents', 'agent', 'agents')}
                  onCreateRoutine={() =>
                    layout.popoverSplit({
                      type: 'component',
                      id: 'routine-compose',
                    })
                  }
                  onOpenRoutine={(id) =>
                    layout.openWithSplit(routineContent(id), {
                      handle: panel.handle,
                      activate: true,
                      search: {},
                      referredFrom: 'agents',
                    })
                  }
                />
              </Match>
              <Match when={mobileLayout()}>{null}</Match>
              <Match when={isTouchDevice()}>{sidebar()}</Match>
              <Match when={true}>{desktopSidebar()}</Match>
            </Switch>
          </ViewShell.Aside>

          <ViewShell.Main class="overflow-hidden">
            <Show
              when={page() === 'archived'}
              fallback={
                <>
                  <ViewTour tour={agentsTour} />
                  <main
                    class="main touch:pt-[calc(var(--mobile-content-inset-top,var(--safe-top,0px))+0.5rem)] touch:[&>*]:[--mobile-content-inset-top:0px]"
                    classList={{
                      hidden:
                        mobileLayout() &&
                        (mobileList() || page() === 'archived'),
                    }}
                  >
                    <Show
                      when={selected()?.conversation}
                      keyed
                      fallback={
                        <>
                          <Show
                            when={
                              page() !== 'routines' &&
                              page() !== 'archived' &&
                              !(
                                mobileLayout() &&
                                (mobileList() || page() === 'archived')
                              )
                            }
                          >
                            <Topbar
                              title={pageTitle()}
                              onBack={
                                mobileLayout() &&
                                !(page() === 'agents' && fromWorkspaceDrawer())
                                  ? backToPreviousPage
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
                                  <AgentSettings
                                    createKind={creatingKind()}
                                    onCloseCreate={() =>
                                      setCreatingKind(undefined)
                                    }
                                  />
                                </Match>
                              </Switch>
                              <div
                                class="contents"
                                classList={{ hidden: page() !== 'new' }}
                              >
                                <NewChatPage
                                  showUpdates={
                                    updatesFlag().enabled && page() === 'new'
                                  }
                                  updateSessions={updateSessions()}
                                  onOpenUpdateSession={(id) => {
                                    const session = updateSessions().find(
                                      (item) => item.id === id
                                    );
                                    if (session)
                                      openConversation(
                                        session,
                                        false,
                                        modeForConversation(session)
                                      );
                                  }}
                                  mode={workspace.mode()}
                                  onModeChange={workspace.setMode}
                                  requestedAgent={requestedAgent()}
                                  active={
                                    !mobileLayout() ||
                                    (!mobileList() && page() === 'new')
                                  }
                                  registerFocus={(focus) => {
                                    composerFocus = focus;
                                  }}
                                  workspaceId={panel.handle.id}
                                  draft={persistedDraft.draft()}
                                  onDraftChange={persistedDraft.setDraft}
                                  roster={rosterSource.roster()}
                                  rosterLoading={rosterSource.loading()}
                                  availabilityLoading={rosterSource.availabilityLoading()}
                                  onStart={startConversation}
                                  onOpenRoster={openRoster}
                                  belowComposer={
                                    <TutorialPill
                                      tutorial="agents"
                                      class="self-center"
                                    />
                                  }
                                />
                              </div>
                            </Suspense>
                          </div>
                        </>
                      }
                    >
                      {(conversation) => (
                        // Per conversation, so one switched away from can't hold
                        // the next in its fallback until its own load settles.
                        <Suspense fallback={<AgentSessionSkeleton />}>
                          <Switch>
                            <Match when={conversation.type === 'agent_session'}>
                              <AgentSessionPane
                                id={conversation.id}
                                notificationSource={notifications}
                                onSessionId={(sessionId) =>
                                  adoptSessionId(conversation.id, sessionId)
                                }
                                onDeleted={showComposer}
                              />
                            </Match>
                            <Match when={true}>
                              <div class="body">
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
                              </div>
                            </Match>
                          </Switch>
                        </Suspense>
                      )}
                    </Show>
                  </main>
                </>
              }
            >
              <Show when={!mobileLayout()}>
                <TraceFlow name="agents.archived">
                  <ArchivedConversations
                    conversations={allArchived()}
                    ownerId={userId()}
                    sort={conversationSort()}
                    modeForConversation={modeForConversation}
                    loading={query.isPending}
                    error={Boolean(query.error)}
                    hasNextPage={Boolean(query.hasNextPage)}
                    loadingNextPage={query.isFetchingNextPage}
                    onLoadMore={() =>
                      fireAndForget(query.fetchNextPage(), 'agents-view')
                    }
                    onRetry={() =>
                      fireAndForget(
                        query.isFetchNextPageError
                          ? query.fetchNextPage()
                          : query.refetch(),
                        'agents-view'
                      )
                    }
                    onOpenConversation={openListedConversation}
                    actions={actions}
                  />
                </TraceFlow>
              </Show>
            </Show>
            <Show
              when={mobileLayout() && (mobileList() || page() === 'archived')}
            >
              <AgentsMobileList>
                <PhoneAgentsList
                  archived={page() === 'archived'}
                  conversations={
                    search() ? conversations() : partitioned().conversations
                  }
                  archivedRows={selectRecentAgentConversations(
                    allArchived(),
                    userId(),
                    archivedSearch(),
                    'updated'
                  )}
                  archivedTotalCount={allArchived().length}
                  conversationTotalCount={
                    partitionArchived(allConversations()).conversations.length
                  }
                  roster={rosterSource.roster()}
                  rosterLoading={rosterSource.loading()}
                  search={page() === 'archived' ? archivedSearch() : search()}
                  onSearchChange={
                    page() === 'archived' ? setArchivedSearch : setSearch
                  }
                  filters={phoneListView().filters()}
                  onFilterChange={(category, value, selected) =>
                    phoneListView().setSelected(category, value, selected)
                  }
                  onClearFilters={() => phoneListView().clear()}
                  showUnlistedRuns={showUnlistedRuns()}
                  onShowUnlistedRunsChange={setShowUnlistedRuns}
                  modeForConversation={modeForConversation}
                  loading={query.isPending}
                  error={Boolean(query.error)}
                  hasNextPage={Boolean(query.hasNextPage)}
                  loadingNextPage={query.isFetchingNextPage}
                  onLoadMore={() =>
                    fireAndForget(query.fetchNextPage(), 'agents-view')
                  }
                  onRetry={() =>
                    fireAndForget(
                      query.isFetchNextPageError
                        ? query.fetchNextPage()
                        : query.refetch(),
                      'agents-view'
                    )
                  }
                  onOpenConversation={openListedConversation}
                  onSelectAgent={(agent) =>
                    mobileAgentRequest.select(userId(), agent.id, agent.kind)
                  }
                  onCreateAgent={() => openPage('agents', 'agent')}
                  onFocusComposer={() => mobileAgentRequest.focus(userId())}
                  actions={actions}
                />
              </AgentsMobileList>
            </Show>
          </ViewShell.Main>
        </ViewShell.Root>
      </div>
    </DataModeProvider>
  );
}

/** Dedicated Agents workspace used by the new app views layout. */
export function AgentsView(props: { route?: AgentsRoute }) {
  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <Suspense fallback={<LoadingComposer />}>
          <SplitPanel.Root>
            <SplitPanel.Body>
              <AgentsWorkspace route={props.route} />
            </SplitPanel.Body>
          </SplitPanel.Root>
        </Suspense>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}

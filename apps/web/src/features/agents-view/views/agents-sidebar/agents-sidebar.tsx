import { createListController } from '@app/components/list';
import {
  CollapsibleSection,
  useViewControlHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import { toEntityActionListState } from '@app/features/next-soup/actions';
import { MaybeSoupEntityActionDrawerManager } from '@app/features/soup';
import { t } from '@app/lib/i18n';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { unreadFilterFn } from '@entity/utils/filter';
import { Key } from '@solid-primitives/keyed';
import { Button, cn } from '@ui';
import { createSignal, Show } from 'solid-js';
import { AgentCreateMenu } from '../../components/AgentsSidebar';
import { AgentsSidebarFooter } from '../../components/agents-sidebar/footer';
import { AgentsSidebarHeader } from '../../components/agents-sidebar/header';
import { AgentsSidebarRoot } from '../../components/agents-sidebar/root';
import {
  ConversationFiltersControl,
  type ConversationFiltersProps,
} from '../../components/conversation-filters/conversation-filters';
import { ConversationSectionHeading } from '../../components/conversation-section/heading';
import { ConversationSkeleton } from '../../components/conversation-skeleton/conversation-skeleton';
import { ConversationSortControl } from '../../components/conversation-sort/conversation-sort';
import { SessionStatusGlyph } from '../../components/session-status-glyph/session-status-glyph';
import type { ConversationActions } from '../../context/conversation-actions';
import type { AgentKind } from '../../core/agent-kind';
import {
  activeFilterCount,
  conversationFacts,
} from '../../core/conversation-filters';
import type { ConversationSort } from '../../core/conversation-list';
import type { AgentsMode } from '../../core/mode';
import type { AgentsPage } from '../../core/pages';
import type { AgentConversationEntity } from '../../core/recent-conversations';
import { createConversationList } from '../../primitives/conversation-list';
import { ConversationContextMenu } from '../shared/conversation-context-menu/conversation-context-menu';
import { ConversationRow } from '../shared/conversation-row/conversation-row';

export type DesktopAgentsSidebarProps = ConversationFiltersProps & {
  ownerId?: string;
  sort: ConversationSort;
  onSortChange: (sort: ConversationSort) => void;
  activePage?: AgentsPage;
  onOpenPage: (page: AgentsPage) => void;
  onCreateAgent: (kind: AgentKind) => void;
  onCreateRoutine: () => void;
  modeForConversation: (conversation: AgentConversationEntity) => AgentsMode;
  activeConversationId?: string;
  search: string;
  conversations: AgentConversationEntity[];
  archived: AgentConversationEntity[];
  loading: boolean;
  error: boolean;
  hasNextPage: boolean;
  loadingNextPage: boolean;
  showOpenPullRequests: boolean;
  onSearchChange: (search: string) => void;
  onOpenConversation: (
    conversation: AgentConversationEntity,
    event?: MouseEvent
  ) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  actions: ConversationActions;
};

export function DesktopAgentsSidebar(props: DesktopAgentsSidebarProps) {
  const panel = useSplitPanelOrThrow();
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [conversationsOpen, setConversationsOpen] = createSignal(true);
  const [openPullRequestsOpen, setOpenPullRequestsOpen] = createSignal(true);
  let searchInput: HTMLInputElement | undefined;
  const factsOf = (row: AgentConversationEntity) =>
    conversationFacts(row, props.modeForConversation(row), unreadFilterFn(row));
  const listState = createConversationList({
    conversations: () => props.conversations,
    archived: () => props.archived,
    filters: () => props.filters,
    sort: () => props.sort,
    factsOf,
    hasNextPage: () => props.hasNextPage,
    loading: () => props.loading,
    loadingNextPage: () => props.loadingNextPage,
    error: () => props.error,
    onLoadMore: props.onLoadMore,
    fill: () => 'conversations',
    openPullRequestOwnerId: () =>
      props.showOpenPullRequests ? props.ownerId : undefined,
  });
  const visibleCount = () =>
    listState.waiting().length +
    listState.openPullRequests().length +
    listState.conversations().length;
  const openPullRequests = listState.openPullRequests;
  const controller = createListController({
    items: () => [
      ...new Map(
        [
          ...listState.waiting(),
          ...openPullRequests(),
          ...listState.conversations(),
        ].map((row) => [row.id, row])
      ).values(),
    ],
    getKey: (row) => row.id,
    isSelectable: () => false,
  });
  const list = toEntityActionListState({ controller, getEntity: (row) => row });
  const changeSearchOpen = (open: boolean) => {
    setSearchOpen(open);
    if (!open) props.onSearchChange('');
    else {
      setConversationsOpen(true);
      queueMicrotask(() => searchInput?.focus());
    }
  };
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: t('agentWork.searchAgentChats'),
      condition: () => props.activePage !== 'routines',
      run: () => {
        changeSearchOpen(true);
        return true;
      },
    },
  });
  const onScroll = (event: Event & { currentTarget: HTMLElement }) => {
    listState.loadMoreNearEnd(event.currentTarget);
  };
  const renderRows = (rows: AgentConversationEntity[], waiting = false) => (
    <Key each={rows} by="id">
      {(row) => (
        <ConversationContextMenu conversation={row()} list={list}>
          <ConversationRow
            conversation={row()}
            mode={props.modeForConversation(row())}
            sort={props.sort}
            waiting={waiting}
            active={props.activeConversationId === row().id}
            actions={props.actions}
            onOpen={(event) => props.onOpenConversation(row(), event)}
          />
        </ConversationContextMenu>
      )}
    </Key>
  );
  const emptyText = () => {
    if (props.search.trim())
      return t('agentWork.noSearchMatches', { query: props.search.trim() });
    if (activeFilterCount(props.filters)) return t('agentWork.noFilterMatches');
    return t('agentWork.noConversations');
  };

  return (
    <MaybeSoupEntityActionDrawerManager>
      <AgentsSidebarRoot
        activePage={props.activePage}
        onOpenPage={props.onOpenPage}
      >
        <AgentsSidebarHeader
          search={props.search}
          searchOpen={searchOpen() || !!props.search}
          onSearchChange={props.onSearchChange}
          onSearchOpenChange={changeSearchOpen}
          inputRef={(input) => {
            searchInput = input;
          }}
        />
        <ViewSidebar.Primary>
          <AgentCreateMenu
            onCreate={props.onCreateAgent}
            onRoutine={props.onCreateRoutine}
            onConversation={() => props.onOpenPage('new')}
          />
        </ViewSidebar.Primary>
        <ViewSidebar.Content class="gap-2 overflow-hidden pt-2">
          <Show when={listState.waiting().length > 0}>
            <section
              class="flex min-h-0 max-h-[40%] shrink-0 flex-col"
              aria-label={t('agentWork.waitingOnYou')}
            >
              <ConversationSectionHeading
                title={t('agentWork.waitingOnYou')}
                count={listState.waiting().length}
                icon={<SessionStatusGlyph state="waiting" />}
              />
              <ViewSidebar.Nav
                class="min-h-0 overflow-auto"
                onScroll={onScroll}
              >
                {renderRows(listState.waiting(), true)}
              </ViewSidebar.Nav>
            </section>
          </Show>
          <Show when={openPullRequests().length > 0}>
            <CollapsibleSection.Root
              open={openPullRequestsOpen()}
              onOpenChange={setOpenPullRequestsOpen}
              class={cn(
                'flex min-h-0 flex-col',
                openPullRequestsOpen() ? 'max-h-[40%]' : 'shrink-0'
              )}
            >
              <CollapsibleSection.Header>
                <CollapsibleSection.Trigger>
                  <span>{t('agentWork.openPullRequests')}</span>
                  <span class="text-ink-extra-muted tabular-nums">
                    {openPullRequests().length}
                  </span>
                  <CollapsibleSection.Indicator />
                </CollapsibleSection.Trigger>
              </CollapsibleSection.Header>
              <CollapsibleSection.Content class="flex min-h-0 flex-col">
                <ViewSidebar.Nav
                  class="min-h-0 overflow-auto"
                  aria-label={t('agentWork.openPullRequestsLabel')}
                  onScroll={onScroll}
                >
                  {renderRows(openPullRequests())}
                </ViewSidebar.Nav>
              </CollapsibleSection.Content>
            </CollapsibleSection.Root>
          </Show>
          <CollapsibleSection.Root
            open={conversationsOpen()}
            onOpenChange={setConversationsOpen}
            class={cn(
              'flex min-h-0 flex-col',
              conversationsOpen() ? 'flex-1' : 'shrink-0'
            )}
          >
            <CollapsibleSection.Header>
              <CollapsibleSection.Trigger class="flex-1">
                <span>{t('agentWork.conversations')}</span>
                <CollapsibleSection.Indicator />
              </CollapsibleSection.Trigger>
              <div class="flex shrink-0 items-center gap-0.5 pr-1">
                <ConversationSortControl
                  value={props.sort}
                  onChange={props.onSortChange}
                />
                <ConversationFiltersControl
                  filters={props.filters}
                  onFilterChange={props.onFilterChange}
                  onClearFilters={props.onClearFilters}
                  showUnlistedRuns={props.showUnlistedRuns}
                  onShowUnlistedRunsChange={props.onShowUnlistedRunsChange}
                />
              </div>
            </CollapsibleSection.Header>
            <CollapsibleSection.Content class="flex min-h-0 flex-1 flex-col">
              <ViewSidebar.Nav
                class="min-h-0 flex-1 shrink overflow-auto"
                aria-label={t('agentWork.conversations')}
                aria-busy={props.loading || props.loadingNextPage}
                onScroll={onScroll}
              >
                {renderRows(listState.conversations())}
                <Show when={props.loading && visibleCount() === 0}>
                  <ConversationSkeleton />
                </Show>
                <Show when={props.error}>
                  <Button variant="ghost" size="sm" onClick={props.onRetry}>
                    {t('agentWork.retryLoading')}
                  </Button>
                </Show>
                <Show
                  when={!props.loading && !props.error && visibleCount() === 0}
                >
                  <p class="px-2 py-2 text-xs text-ink-muted">{emptyText()}</p>
                  <Show when={activeFilterCount(props.filters) > 0}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={props.onClearFilters}
                    >
                      {t('viewMenus.clearFilters')}
                    </Button>
                  </Show>
                </Show>
                <Show when={props.loadingNextPage}>
                  <ConversationSkeleton rows={3} />
                </Show>
              </ViewSidebar.Nav>
            </CollapsibleSection.Content>
          </CollapsibleSection.Root>
        </ViewSidebar.Content>
        <AgentsSidebarFooter />
      </AgentsSidebarRoot>
    </MaybeSoupEntityActionDrawerManager>
  );
}

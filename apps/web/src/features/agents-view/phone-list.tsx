import { createListController } from '@app/components/list';
import { MobileListLayout } from '@app/components/view-shell/MobileListLayout';
import { toEntityActionListState } from '@app/features/next-soup/actions';
import { MaybeSoupEntityActionDrawerManager } from '@app/features/soup';
import EmptyStateAi from '@app/lib/design/empty-state-ai.svg';
import { t } from '@app/lib/i18n';
import { unreadFilterFn } from '@entity/utils/filter';
import PlusIcon from '@icon/system/regular/plus.svg';
import StarIcon from '@icon/system/regular/star.svg';
import { useFavoritesData } from '@queries/favorites/favorites';
import { isSessionArchived } from '@service-agent-harness/session-archive';
import { Button, EmptyStatePanel } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { AgentBubble } from './components/agent-bubble/agent-bubble';
import { ConversationSkeleton } from './components/conversation-skeleton/conversation-skeleton';
import { PhoneListSection } from './components/phone-list-section';
import { SessionStatusGlyph } from './components/session-status-glyph/session-status-glyph';
import type { ConversationActions } from './context/conversation-actions';
import {
  type ConversationFilters,
  conversationFacts,
} from './core/conversation-filters';
import { sortConversations } from './core/conversation-list';
import type { AgentsMode } from './core/mode';
import {
  partitionPhoneConversations,
  startableCustomAgents,
} from './core/phone-list';
import type { AgentConversationEntity } from './core/recent-conversations';
import type { RosterAgent } from './core/roster';
import { createConversationList } from './primitives/conversation-list';
import { PhoneListHeader } from './views/mobile/phone-list-header';
import { ConversationContextMenu } from './views/shared/conversation-context-menu/conversation-context-menu';
import { PhoneConversationRow } from './views/shared/phone-conversation-row/phone-conversation-row';

export function PhoneAgentsList(props: {
  archived: boolean;
  conversations: AgentConversationEntity[];
  archivedRows: AgentConversationEntity[];
  archivedTotalCount: number;
  conversationTotalCount: number;
  roster: RosterAgent[];
  rosterLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  filters: ConversationFilters;
  onFilterChange: (
    category: keyof ConversationFilters,
    value:
      | 'chat'
      | 'code'
      | 'waiting'
      | 'working'
      | 'unread'
      | 'idle'
      | 'open'
      | 'draft'
      | 'merged'
      | 'closed'
      | 'none',
    selected: boolean
  ) => void;
  onClearFilters: () => void;
  showUnlistedRuns: boolean;
  onShowUnlistedRunsChange: (value: boolean) => void;
  modeForConversation: (row: AgentConversationEntity) => AgentsMode;
  loading: boolean;
  error: boolean;
  hasNextPage: boolean;
  loadingNextPage: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onOpenConversation: (row: AgentConversationEntity, event: MouseEvent) => void;
  onSelectAgent: (agent: RosterAgent) => void;
  onCreateAgent: () => void;
  actions: ConversationActions;
  onFocusComposer: () => void;
}) {
  const favorites = useFavoritesData({ entityType: ['chat', 'agent_session'] });
  const identities = createMemo(
    () =>
      new Set(
        favorites()?.favorites.map(
          (favorite) => `${favorite.entityType}:${favorite.entityId}`
        ) ?? []
      )
  );
  const facts = (row: AgentConversationEntity) =>
    conversationFacts(row, props.modeForConversation(row), unreadFilterFn(row));
  const listState = createConversationList({
    conversations: () => props.conversations,
    archived: () => props.archivedRows,
    filters: () => props.filters,
    sort: () => 'updated',
    factsOf: facts,
    hasNextPage: () => props.hasNextPage,
    loading: () => props.loading,
    loadingNextPage: () => props.loadingNextPage,
    error: () => props.error,
    onLoadMore: props.onLoadMore,
    fill: () => (props.archived ? 'archived' : 'conversations'),
  });
  const sections = createMemo(() =>
    partitionPhoneConversations(
      [...listState.waiting(), ...listState.conversations()],
      identities(),
      facts
    )
  );
  const exhausted = () => !props.hasNextPage && !props.loading && !props.error;
  const empty = () =>
    exhausted() &&
    !props.search &&
    (props.archived
      ? props.archivedTotalCount
      : props.conversationTotalCount) === 0;
  const visible = () =>
    props.archived
      ? listState.archived()
      : [
          ...sections().favorites,
          ...sections().waiting,
          ...sections().conversations,
        ];
  const controller = createListController({
    items: visible,
    getKey: (row) => row.id,
    isSelectable: () => false,
  });
  const list = toEntityActionListState({ controller, getEntity: (row) => row });
  const renderRows = (rows: AgentConversationEntity[], waiting = false) => (
    <For each={rows}>
      {(row) => (
        <ConversationContextMenu conversation={row} list={list}>
          <PhoneConversationRow
            archived={
              Boolean(props.search) &&
              row.type === 'agent_session' &&
              isSessionArchived(row)
            }
            conversation={row}
            search={props.search}
            mode={props.modeForConversation(row)}
            waiting={waiting}
            actions={props.actions}
            onOpen={(event) => props.onOpenConversation(row, event)}
          />
        </ConversationContextMenu>
      )}
    </For>
  );
  const collectionTitle = () =>
    props.archived ? t('viewMenus.archived') : t('agentWork.conversations');
  const collectionCount = () => {
    if (!exhausted()) return undefined;
    return props.archived
      ? props.archivedTotalCount
      : props.conversationTotalCount;
  };
  const collectionRows = () => {
    if (props.archived) return listState.archived();
    if (props.search) return sortConversations(visible(), 'updated');
    return sections().conversations;
  };
  return (
    <div class="flex size-full min-h-0 flex-col">
      <MobileListLayout
        header={
          <PhoneListHeader
            archived={props.archived}
            empty={empty()}
            search={props.search}
            onSearchChange={props.onSearchChange}
            filters={props.filters}
            onFilterChange={props.onFilterChange}
            onClearFilters={props.onClearFilters}
            showUnlistedRuns={props.showUnlistedRuns}
            onShowUnlistedRunsChange={props.onShowUnlistedRunsChange}
          />
        }
      >
        <MaybeSoupEntityActionDrawerManager>
          {/* Only the scrollport reserves the islands; each section bounds its own sticky heading. */}
          <div
            data-agents-list-scroll
            class="min-h-0 flex-1 overflow-y-auto pt-(--mobile-content-inset-top)"
            onScroll={(event) => listState.loadMoreNearEnd(event.currentTarget)}
          >
            <div class="flex min-h-full flex-col gap-5">
              <Show
                when={!props.archived && !props.rosterLoading && !props.search}
              >
                <div
                  role="group"
                  aria-label={t('nav.agents')}
                  class="scrollbar-hidden flex shrink-0 gap-2 overflow-x-auto overscroll-x-contain px-(--mobile-chrome-gutter) pt-2"
                >
                  <For each={startableCustomAgents(props.roster)}>
                    {(agent) => (
                      <AgentBubble
                        agent={agent}
                        onSelect={() => props.onSelectAgent(agent)}
                      />
                    )}
                  </For>
                  <AgentBubble onSelect={props.onCreateAgent} />
                </div>
              </Show>
              <div class="flex min-h-0 flex-1 flex-col gap-3">
                <Show
                  when={
                    !props.archived &&
                    !props.search &&
                    sections().waiting.length > 0
                  }
                >
                  <div class="px-3">
                    <PhoneListSection.Root
                      title={t('agentWork.waitingOnYou')}
                      card
                    >
                      <PhoneListSection.Heading
                        title={t('agentWork.waitingOnYou')}
                        count={sections().waiting.length}
                        icon={<SessionStatusGlyph state="waiting" />}
                        card
                      />
                      <PhoneListSection.Body>
                        {renderRows(sections().waiting, true)}
                      </PhoneListSection.Body>
                    </PhoneListSection.Root>
                  </div>
                </Show>
                <Show
                  when={
                    !props.archived &&
                    !props.search &&
                    sections().favorites.length > 0
                  }
                >
                  <div class="px-3">
                    <PhoneListSection.Root
                      title={t('agentWork.favorites')}
                      card
                    >
                      <PhoneListSection.Heading
                        title={t('agentWork.favorites')}
                        count={sections().favorites.length}
                        icon={<StarIcon class="size-3.5" />}
                        card
                      />
                      <PhoneListSection.Body>
                        {renderRows(sections().favorites)}
                      </PhoneListSection.Body>
                    </PhoneListSection.Root>
                  </div>
                </Show>
                <PhoneListSection.Root title={collectionTitle()}>
                  <PhoneListSection.Heading
                    title={collectionTitle()}
                    count={collectionCount()}
                  />
                  <PhoneListSection.Body>
                    <Show
                      when={empty()}
                      fallback={
                        <>
                          {renderRows(collectionRows())}
                          <Show when={exhausted() && visible().length === 0}>
                            <p class="py-8 text-center text-sm text-ink-muted">
                              {props.search
                                ? t('agentWork.noSearchMatches', {
                                    query: props.search,
                                  })
                                : t('agentWork.noFilterMatches')}
                            </p>
                          </Show>
                          <Show when={props.loading || props.loadingNextPage}>
                            <ConversationSkeleton rows={3} />
                          </Show>
                          <Show when={props.error}>
                            <Button variant="ghost" onClick={props.onRetry}>
                              {t('agentWork.retryLoading')}
                            </Button>
                          </Show>
                          <Show
                            when={
                              props.hasNextPage &&
                              !props.loadingNextPage &&
                              !props.error
                            }
                          >
                            <Button variant="ghost" onClick={props.onLoadMore}>
                              {t('agentWork.loadMoreActivity')}
                            </Button>
                          </Show>
                        </>
                      }
                    >
                      <EmptyStatePanel
                        centered
                        graphic={EmptyStateAi}
                        title={
                          props.archived
                            ? t('agentWork.noArchivedConversationsTitle')
                            : t('agentWork.noConversationsYet')
                        }
                        primaryAction={
                          props.archived
                            ? undefined
                            : {
                                label: t('agentWork.startConversation'),
                                icon: PlusIcon,
                                onClick: props.onFocusComposer,
                              }
                        }
                        class="h-auto min-h-80 flex-1 overflow-visible [--mobile-content-inset-top:0px]"
                      />
                    </Show>
                  </PhoneListSection.Body>
                </PhoneListSection.Root>
              </div>
            </div>
          </div>
        </MaybeSoupEntityActionDrawerManager>
      </MobileListLayout>
    </div>
  );
}

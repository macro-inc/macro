import { createListController } from '@app/components/list';
import { ChannelPinGrid } from '@app/features/channels-view/components/ChannelPins';
import { toEntityActionListState } from '@app/features/next-soup/actions';
import { MaybeSoupEntityActionDrawerManager } from '@app/features/soup';
import { t } from '@app/lib/i18n';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { SplitHeaderScope } from '@components/app/SplitHeaderScope';
import { unreadFilterFn } from '@entity/utils/filter';
import StarIcon from '@icon/system/regular/star.svg';
import { useFavoritesData } from '@queries/favorites/favorites';
import { isSessionArchived } from '@service-agent-harness/session-archive';
import { Button } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { AgentBubble } from './components/agent-bubble/agent-bubble';
import { ConversationSkeleton } from './components/conversation-skeleton/conversation-skeleton';
import { SessionStatusGlyph } from './components/session-status-glyph/session-status-glyph';
import type { ConversationActions } from './context/conversation-actions';
import {
  activeFilterCount,
  type ConversationFilters,
  conversationFacts,
  EMPTY_CONVERSATION_FILTERS,
} from './core/conversation-filters';
import { sortConversations } from './core/conversation-list';
import type { AgentsMode } from './core/mode';
import type { AgentsPage } from './core/pages';
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
  onOpenPage: (page: AgentsPage) => void;
  onBack: () => void;
  onOpenConversation: (row: AgentConversationEntity, event: MouseEvent) => void;
  onSelectAgent: (agent: RosterAgent) => void;
  onCreateAgent: () => void;
  actions: ConversationActions;
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
    filters: () =>
      props.archived ? EMPTY_CONVERSATION_FILTERS : props.filters,
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
  return (
    <SplitHeaderScope.Root>
      <MaybeSoupEntityActionDrawerManager>
        <SplitHeaderScope.TopBar />
        <Show when={props.archived}>
          <FloatRegion region="accessory" priority={10} active={() => true}>
            <span />
          </FloatRegion>
        </Show>
        <PhoneListHeader
          archived={props.archived}
          search={props.search}
          onSearchChange={props.onSearchChange}
          onBack={props.onBack}
          onOpenPage={props.onOpenPage}
          archivedCount={
            !props.hasNextPage && !props.loading && !props.error
              ? props.archivedTotalCount
              : undefined
          }
          filters={props.filters}
          onFilterChange={props.onFilterChange}
          onClearFilters={props.onClearFilters}
          showUnlistedRuns={props.showUnlistedRuns}
          onShowUnlistedRunsChange={props.onShowUnlistedRunsChange}
        />
        <div
          class="size-full min-h-0 overflow-auto"
          classList={{
            'pt-2': props.archived || !!props.search || props.rosterLoading,
          }}
          onScroll={(event) => listState.loadMoreNearEnd(event.currentTarget)}
        >
          <Show when={!props.archived && !props.rosterLoading && !props.search}>
            <ChannelPinGrid horizontal>
              <For each={startableCustomAgents(props.roster)}>
                {(agent) => (
                  <AgentBubble
                    agent={agent}
                    onSelect={() => props.onSelectAgent(agent)}
                  />
                )}
              </For>
              <AgentBubble onSelect={props.onCreateAgent} />
            </ChannelPinGrid>
          </Show>
          <Show
            when={
              !props.archived &&
              !props.search &&
              sections().favorites.length > 0
            }
          >
            <section
              aria-label={t('agentWork.favorites')}
              class="mx-3 mb-3 rounded-[20px] bg-surface-3 py-1"
            >
              <h2 class="flex h-9 items-center gap-1.5 px-3 text-sm font-semibold text-ink-muted">
                <span class="flex w-5 justify-center">
                  <StarIcon class="size-3.5" />
                </span>
                {t('agentWork.favorites')}
                <span class="font-normal text-ink-extra-muted/70">
                  {sections().favorites.length}
                </span>
              </h2>
              {renderRows(sections().favorites)}
            </section>
          </Show>
          <Show
            when={
              !props.archived && !props.search && sections().waiting.length > 0
            }
          >
            <section
              aria-label={t('agentWork.waitingOnYou')}
              class="mx-3 mb-3 rounded-[20px] bg-surface-3 py-1"
            >
              <h2 class="flex h-9 items-center gap-1.5 px-3 text-sm font-semibold text-ink-muted">
                <span class="flex w-5 justify-center">
                  <SessionStatusGlyph state="waiting" />
                </span>
                {t('agentWork.waitingOnYou')}
                <span class="font-normal text-ink-extra-muted/70">
                  {sections().waiting.length}
                </span>
              </h2>
              {renderRows(sections().waiting, true)}
            </section>
          </Show>
          {renderRows(
            props.archived
              ? listState.archived()
              : props.search
                ? sortConversations(visible(), 'updated')
                : sections().conversations
          )}
          <Show
            when={
              !props.archived &&
              !props.loading &&
              visible().length === 0 &&
              !props.search &&
              !activeFilterCount(props.filters)
            }
          >
            <section class="px-3">
              <h2 class="px-3 py-2 text-sm font-semibold text-ink-muted">
                {t('agentWork.yourAgents')}
              </h2>
              <Show
                when={startableCustomAgents(props.roster).length > 0}
                fallback={
                  <Button
                    variant="ghost"
                    class="h-[46px] w-full justify-start font-normal"
                    onClick={props.onCreateAgent}
                  >
                    {t('agentWork.newAgent')}
                  </Button>
                }
              >
                <For each={startableCustomAgents(props.roster)}>
                  {(agent) => (
                    <Button
                      variant="ghost"
                      class="flex h-[46px] w-full items-center gap-2 text-left font-normal"
                      onClick={() => props.onSelectAgent(agent)}
                    >
                      <span class="size-5 rounded-full bg-surface-2" />
                      <span class="min-w-0 flex-1 truncate">{agent.name}</span>
                      <span class="text-ink-subtle">{agent.runtime.label}</span>
                    </Button>
                  )}
                </For>
              </Show>
            </section>
          </Show>
          <Show
            when={
              !props.loading &&
              !props.error &&
              visible().length === 0 &&
              (props.archived ||
                props.search ||
                activeFilterCount(props.filters) > 0)
            }
          >
            <p class="py-8 text-center text-sm text-ink-muted">
              {props.search
                ? t('agentWork.noSearchMatches', { query: props.search })
                : props.archived
                  ? t('agentWork.noArchivedConversations')
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
            when={props.hasNextPage && !props.loadingNextPage && !props.error}
          >
            <Button variant="ghost" onClick={props.onLoadMore}>
              {t('agentWork.loadMoreActivity')}
            </Button>
          </Show>
        </div>
      </MaybeSoupEntityActionDrawerManager>
    </SplitHeaderScope.Root>
  );
}

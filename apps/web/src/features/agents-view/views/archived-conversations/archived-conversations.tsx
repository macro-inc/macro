import { createListController } from '@app/components/list';
import { SearchBar } from '@app/components/view-shell';
import { toEntityActionListState } from '@app/features/next-soup/actions';
import { MaybeSoupEntityActionDrawerManager } from '@app/features/soup';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { Key } from '@solid-primitives/keyed';
import { Button } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { ConversationSkeleton } from '../../components/conversation-skeleton/conversation-skeleton';
import type { ConversationActions } from '../../context/conversation-actions';
import {
  conversationFacts,
  EMPTY_CONVERSATION_FILTERS,
} from '../../core/conversation-filters';
import type { ConversationSort } from '../../core/conversation-list';
import type { AgentsMode } from '../../core/mode';
import {
  type AgentConversationEntity,
  selectRecentAgentConversations,
} from '../../core/recent-conversations';
import { createConversationList } from '../../primitives/conversation-list';
import { ArchivedConversationRow } from './archived-conversation-row';

export function ArchivedConversations(props: {
  conversations: AgentConversationEntity[];
  ownerId?: string;
  sort: ConversationSort;
  loading: boolean;
  error: boolean;
  loadingNextPage: boolean;
  hasNextPage: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  modeForConversation: (conversation: AgentConversationEntity) => AgentsMode;
  onOpenConversation: (
    conversation: AgentConversationEntity,
    event: MouseEvent
  ) => void;
  actions: ConversationActions;
}) {
  const [search, setSearch] = createSignal('');
  const rows = createMemo(() =>
    selectRecentAgentConversations(
      props.conversations,
      props.ownerId,
      search(),
      props.sort
    )
  );
  const pending = () => {
    if (props.loading || props.loadingNextPage) return true;
    return props.hasNextPage && !props.error && rows().length === 0;
  };
  usePending('agents.archived.conversations', () => props.loading);
  const listState = createConversationList({
    conversations: () => [],
    archived: rows,
    filters: () => EMPTY_CONVERSATION_FILTERS,
    sort: () => props.sort,
    factsOf: (row) =>
      conversationFacts(row, props.modeForConversation(row), false),
    hasNextPage: () => props.hasNextPage,
    loading: () => props.loading,
    loadingNextPage: () => props.loadingNextPage,
    error: () => props.error,
    onLoadMore: props.onLoadMore,
    fill: () => 'archived',
  });
  const controller = createListController({
    items: rows,
    getKey: (row) => row.id,
    isSelectable: () => false,
  });
  const list = toEntityActionListState({ controller, getEntity: (row) => row });
  const onScroll = (event: Event & { currentTarget: HTMLElement }) => {
    listState.loadMoreNearEnd(event.currentTarget);
  };

  return (
    <MaybeSoupEntityActionDrawerManager>
      <section
        class="flex min-h-0 flex-1 flex-col overflow-auto px-6 py-4"
        aria-label={t('viewMenus.archived')}
        onScroll={onScroll}
      >
        <div class="mb-2 flex shrink-0 items-center gap-1.5 pb-2">
          <h2 class="text-sm font-semibold text-ink">
            {t('viewMenus.archived')}
          </h2>
          <span class="text-xs text-ink-extra-muted/70 tabular-nums">
            {rows().length}
          </span>
          <SearchBar
            class="ml-auto w-[200px]"
            label={t('agentWork.searchArchived')}
            placeholder={t('agentWork.searchArchived')}
            value={search()}
            onValueChange={setSearch}
          />
        </div>
        <div
          class="flex shrink-0 items-center gap-4 px-3 pb-1 text-xs font-medium text-ink-extra-muted"
          aria-hidden="true"
        >
          <span class="min-w-0 flex-1">{t('agentWork.nameColumn')}</span>
          <span class="w-[220px] shrink-0">{t('agentWork.codeColumn')}</span>
          <span class="w-40 shrink-0 text-right">
            {t('agentWork.archivedColumn')}
          </span>
        </div>
        <div class="flex flex-col gap-1">
          <Key each={rows()} by="id">
            {(row) => (
              <ArchivedConversationRow
                conversation={row()}
                mode={props.modeForConversation(row())}
                list={list}
                actions={props.actions}
                onOpen={(event) => props.onOpenConversation(row(), event)}
              />
            )}
          </Key>
          <Show when={!pending() && !props.error && rows().length === 0}>
            <p class="py-8 text-center text-sm text-ink-muted">
              {search().trim()
                ? t('agentWork.noSearchMatches', { query: search().trim() })
                : t('agentWork.noArchivedConversations')}
            </p>
          </Show>
          <Show when={pending()}>
            <ConversationSkeleton rows={3} />
          </Show>
          <Show when={props.error}>
            <Button variant="ghost" size="sm" onClick={props.onRetry}>
              {t('agentWork.retryLoading')}
            </Button>
          </Show>
          <Show
            when={props.hasNextPage && !props.loadingNextPage && !props.error}
          >
            <Button variant="ghost" size="sm" onClick={props.onLoadMore}>
              {t('agentWork.loadMoreActivity')}
            </Button>
          </Show>
        </div>
      </section>
    </MaybeSoupEntityActionDrawerManager>
  );
}

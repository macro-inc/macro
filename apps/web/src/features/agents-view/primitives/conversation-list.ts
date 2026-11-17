import { type Accessor, createEffect, createMemo } from 'solid-js';
import {
  type ConversationFacts,
  type ConversationFilters,
  conversationMatchesFilters,
} from '../core/conversation-filters';
import {
  type ConversationSort,
  partitionWaitingConversations,
  sortConversations,
} from '../core/conversation-list';
import type { AgentConversationEntity } from '../core/recent-conversations';

export type ConversationListSource<Item extends AgentConversationEntity> = {
  conversations: Accessor<readonly Item[]>;
  archived: Accessor<readonly Item[]>;
  filters: Accessor<ConversationFilters>;
  sort: Accessor<ConversationSort>;
  factsOf: (item: Item) => ConversationFacts;
  hasNextPage: Accessor<boolean>;
  loading: Accessor<boolean>;
  loadingNextPage: Accessor<boolean>;
  error: Accessor<boolean>;
  onLoadMore: () => void;
  /** Fill the displayed partition rather than counting rows hidden on another page. */
  fill?: Accessor<'all' | 'conversations' | 'archived'>;
};

/** Shared list projection and pagination decisions, independent of scroll rendering. */
export function createConversationList<Item extends AgentConversationEntity>(
  source: ConversationListSource<Item>
) {
  const active = createMemo(() =>
    sortConversations(
      source
        .conversations()
        .filter((item) =>
          conversationMatchesFilters(source.factsOf(item), source.filters())
        ),
      source.sort()
    )
  );
  const sections = createMemo(() =>
    partitionWaitingConversations(active(), source.factsOf)
  );
  const archived = createMemo(() =>
    sortConversations(
      source
        .archived()
        .filter((item) =>
          conversationMatchesFilters(source.factsOf(item), source.filters())
        ),
      source.sort()
    )
  );
  const canLoadMore = () =>
    source.hasNextPage() &&
    !source.loading() &&
    !source.loadingNextPage() &&
    !source.error();

  // A filtered query can have more pages without enough visible rows to scroll.
  createEffect(() => {
    const partition = source.fill?.() ?? 'all';
    let count = active().length;
    if (partition === 'archived') count = archived().length;
    else if (partition === 'all') count += archived().length;
    if (count < 20 && canLoadMore()) source.onLoadMore();
  });

  const loadMoreNearEnd = (scroll: {
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
  }) => {
    if (
      canLoadMore() &&
      scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 200
    )
      source.onLoadMore();
  };

  return {
    waiting: () => sections().waiting,
    conversations: () => sections().conversations,
    archived,
    loadMoreNearEnd,
  };
}

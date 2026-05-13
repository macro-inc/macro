import {
  createFindBarController,
  type FindBarController,
} from '@core/component/createFindBarController';
import { extractSearchTerms } from '@core/util/searchHighlight';
import {
  type ChannelMessageEntity,
  isChannelMessageEntity,
  type WithSearch,
} from '@entity';
import {
  useSearchChannelQuery,
  validateSearchServiceText,
} from '@queries/soup/search';
import { ChannelSortTimestamp } from '@service-search/generated/models';
import { type Accessor, createEffect, createMemo } from 'solid-js';
import type { SearchHighlightTermsLookup } from '../Message/context';

const FIND_BAR_PAGE_SIZE = 50;
const FIND_BAR_PREFETCH_THRESHOLD = 10;

type CreateChannelFindBarOptions = {
  channelId: Accessor<string>;
  goToMessage: (messageId: string, replyId?: string) => void;
  clearSelection: () => void;
};

export type ChannelFindBar = FindBarController & {
  /** Per-message highlight terms derived from loaded search results. */
  getSearchTermsForMessage: Accessor<SearchHighlightTermsLookup | undefined>;
};

export function createChannelFindBar(
  options: CreateChannelFindBarOptions
): ChannelFindBar {
  let termsByMessageId: Accessor<Map<string, string[]>> = () => new Map();

  const controller = createFindBarController<WithSearch<ChannelMessageEntity>>(
    ({ isOpen, submittedQuery, activeIndex }) => {
      // Channel-only search with thread sort so results paginate monotonically
      // through the channel's thread list (replies cluster with their parent
      // thread instead of jumping around when sorted strictly by message_id).
      const searchQuery = useSearchChannelQuery(
        () => ({
          params: { page_size: FIND_BAR_PAGE_SIZE },
          body: {
            match_type: 'partial',
            query: submittedQuery(),
            search_on: 'content',
            channel_ids: [options.channelId()],
            sort: ChannelSortTimestamp.thread,
          },
        }),
        () => ({ enabled: isOpen() && submittedQuery().length > 0 })
      );

      const results = createMemo<WithSearch<ChannelMessageEntity>[]>(() => {
        if (!submittedQuery()) return [];
        if (searchQuery.isPlaceholderData) return [];
        if (!searchQuery.isSuccess) return [];
        const data = searchQuery.data;
        if (!data) return [];
        return data.items.filter(
          (e): e is WithSearch<ChannelMessageEntity> =>
            isChannelMessageEntity(e) && e.channelId === options.channelId()
        );
      });

      termsByMessageId = createMemo<Map<string, string[]>>(() => {
        if (!isOpen()) return new Map();
        const map = new Map<string, string[]>();
        for (const entity of results()) {
          const hit = entity.search.contentHitData?.[0]?.content;
          if (!hit) continue;
          const terms = [
            ...new Set(extractSearchTerms(hit).filter((t) => t.length > 0)),
          ];
          if (!terms.length) continue;
          const existing = map.get(entity.messageId);
          if (existing) {
            for (const t of terms) {
              if (!existing.includes(t)) existing.push(t);
            }
          } else {
            map.set(entity.messageId, terms);
          }
        }
        return map;
      });

      const totalCount = createMemo<number | undefined>(() => {
        if (!submittedQuery()) return undefined;
        if (searchQuery.isPlaceholderData) return undefined;
        if (!searchQuery.isSuccess) return undefined;
        return searchQuery.data?.totalCount;
      });

      // Prefetch the next page when the cursor approaches the end of the
      // loaded results so navigating to the boundary doesn't stall on a
      // network round-trip.
      createEffect(() => {
        const rs = results();
        const idx = activeIndex();
        if (idx === 0 || rs.length === 0) return;
        if (!searchQuery.hasNextPage || searchQuery.isFetchingNextPage) return;
        if (rs.length - idx <= FIND_BAR_PREFETCH_THRESHOLD) {
          searchQuery.fetchNextPage();
        }
      });

      return {
        results,
        totalCount,
        isFetching: () => searchQuery.isFetching,
        validateText: validateSearchServiceText,
        navigate: (result) => {
          if (result.threadId) {
            options.goToMessage(result.threadId, result.messageId);
          } else {
            options.goToMessage(result.messageId);
          }
        },
      };
    },
    {
      onBeforeSubmit: () => options.clearSelection(),
    }
  );

  const getSearchTermsForMessage: Accessor<
    SearchHighlightTermsLookup | undefined
  > = () => {
    const map = termsByMessageId();
    if (map.size === 0) return undefined;
    return (messageId: string) => map.get(messageId);
  };

  return { ...controller, getSearchTermsForMessage };
}

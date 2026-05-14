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
import {
  type Accessor,
  createEffect,
  createMemo,
  createSelector,
} from 'solid-js';
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
  getSearchTermsForMessage: SearchHighlightTermsLookup;
};

type ActiveMatch = { messageId: string; terms: string[] };

export function createChannelFindBar(
  options: CreateChannelFindBarOptions
): ChannelFindBar {
  let activeMatch: Accessor<ActiveMatch | undefined> = () => undefined;

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

      // Highlight only the active match so we never paint spans we don't
      // have hit data for (results outside the loaded page have no terms).
      activeMatch = createMemo<ActiveMatch | undefined>(() => {
        if (!isOpen()) return undefined;
        const idx = activeIndex();
        if (idx === 0) return undefined;
        const entity = results()[idx - 1];
        if (!entity) return undefined;
        const termSet = new Set<string>();
        for (const hit of entity.search.contentHitData ?? []) {
          for (const term of extractSearchTerms(hit.content)) {
            if (term.length) termSet.add(term);
          }
        }
        if (termSet.size === 0) return undefined;
        return { messageId: entity.messageId, terms: [...termSet] };
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

  const isActiveMessage = createSelector<string | undefined, string>(
    () => activeMatch()?.messageId
  );

  const getSearchTermsForMessage: SearchHighlightTermsLookup = (messageId) =>
    isActiveMessage(messageId) ? activeMatch()?.terms : undefined;

  return { ...controller, getSearchTermsForMessage };
}

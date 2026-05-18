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
import { channelMessagesQueryOptions } from '@queries/channel/channel-messages';
import { threadRepliesQueryOptions } from '@queries/channel/thread-replies';
import { queryClient } from '@queries/client';
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
const FIND_BAR_REPLY_PREFETCH_LOOKAHEAD = 2;
const FIND_BAR_MESSAGES_PREFETCH_LOOKAHEAD = 2;

type CreateChannelFindBarOptions = {
  channelId: Accessor<string>;
  goToMessage: (messageId: string, replyId?: string) => void;
  clearSelection: () => void;
  isMessageLoaded: (messageId: string) => boolean;
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

      // Prefetch /replies for the next few reply hits ahead of the cursor.
      // ChannelThread fires the replies query only on mount with `targetReplyId`
      // set, so the very first reply-nav into each thread always pays a round-trip.
      // Warming the cache in advance hides that latency on rapid next/prev.
      // `prefetchQuery` is a no-op when the cached entry is fresh (staleTime is
      // Infinity for replies), so re-runs are cheap.
      createEffect(() => {
        const rs = results();
        const idx = activeIndex();
        if (idx === 0 || rs.length === 0) return;

        const channelId = options.channelId();
        const end = Math.min(
          idx + FIND_BAR_REPLY_PREFETCH_LOOKAHEAD,
          rs.length
        );
        for (let i = idx; i < end; i++) {
          const threadId = rs[i].threadId;
          if (!threadId) continue;
          queryClient.prefetchQuery(
            threadRepliesQueryOptions(channelId, threadId)
          );
        }
      });

      // Prefetch the load-around channel-messages window for the next few hits.
      // When the user navigates to a result that's outside the current message
      // window, tmc switches `loadAroundMessageId` to that id and `/messages?
      // load_around_message_id=…` fetches a 50-row window centered on it. That
      // round-trip is the dominant delay on rapid find-bar navigation through
      // older messages. Skip hits that are already in the loaded window (we'd
      // never actually fire an around-fetch for them) and dedupe so multiple
      // replies to the same parent thread share one prefetch.
      createEffect(() => {
        const rs = results();
        const idx = activeIndex();
        if (idx === 0 || rs.length === 0) return;

        const channelId = options.channelId();
        const end = Math.min(
          idx + FIND_BAR_MESSAGES_PREFETCH_LOOKAHEAD,
          rs.length
        );
        const seen = new Set<string>();
        for (let i = idx; i < end; i++) {
          const aroundId = rs[i].threadId ?? rs[i].messageId;
          if (seen.has(aroundId)) continue;
          seen.add(aroundId);
          if (options.isMessageLoaded(aroundId)) continue;
          queryClient.prefetchInfiniteQuery(
            channelMessagesQueryOptions(channelId, aroundId)
          );
        }
      });

      return {
        results,
        totalCount,
        isFetching: () => searchQuery.isFetching,
        validateText: validateSearchServiceText,
        // Only wrap past the most recent result once every page is loaded —
        // otherwise wrapping would jump to a "last" result that isn't truly
        // the global oldest hit.
        wrapPrevious: () => !searchQuery.hasNextPage,
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

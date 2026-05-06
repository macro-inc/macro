import { QUERY_FILTERS_BASE } from '@app/component/next-soup/filters/query-filters';
import {
  isChannelMessageEntity,
  type ChannelMessageEntity,
  type WithSearch,
} from '@entity';
import {
  useSearchSoupQuery,
  validateSearchServiceText,
} from '@queries/soup/search';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';

const FIND_BAR_PAGE_SIZE = 50;
const FIND_BAR_PREFETCH_THRESHOLD = 10;

type CreateChannelFindBarOptions = {
  channelId: Accessor<string>;
  goToMessage: (messageId: string, replyId?: string) => void;
  clearSelection: () => void;
};

export type ChannelFindBar = ReturnType<typeof createChannelFindBar>;

export function createChannelFindBar(options: CreateChannelFindBarOptions) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [submittedQuery, setSubmittedQuery] = createSignal('');
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [inputEl, setInputEl] = createSignal<HTMLInputElement>();

  const searchQuery = useSearchSoupQuery(
    () => ({
      params: { page_size: FIND_BAR_PAGE_SIZE },
      body: {
        match_type: 'partial',
        query: submittedQuery(),
        search_on: 'content',
        filters: {
          ...QUERY_FILTERS_BASE,
          channel_filters: { channel_ids: [options.channelId()] },
        },
      },
    }),
    () => ({ enabled: isOpen() && submittedQuery().length > 0 })
  );

  const results = createMemo<WithSearch<ChannelMessageEntity>[]>(() => {
    if (!submittedQuery()) return [];
    // While a new submitted-query is in flight, ignore the placeholder data
    // from the previous query so we don't auto-jump to a stale result.
    // (`fetchNextPage` doesn't trigger placeholder mode — same queryKey.)
    if (searchQuery.isPlaceholderData) return [];
    if (!searchQuery.isSuccess) return [];
    const data = searchQuery.data;
    if (!data) return [];
    return data.filter(
      (e): e is WithSearch<ChannelMessageEntity> =>
        isChannelMessageEntity(e) && e.channelId === options.channelId()
    );
  });

  const goToResult = (result: ChannelMessageEntity) => {
    if (result.threadId) {
      options.goToMessage(result.threadId, result.messageId);
    } else {
      options.goToMessage(result.messageId);
    }
  };

  createEffect(on(submittedQuery, () => setActiveIndex(0), { defer: true }));

  createEffect(
    on(results, (rs) => {
      if (!isOpen()) return;
      if (rs.length === 0) {
        setActiveIndex(0);
        return;
      }
      const current = activeIndex();
      const next =
        current === 0 ? 1 : Math.max(1, Math.min(current, rs.length));
      setActiveIndex(next);
      goToResult(rs[next - 1]);
    })
  );

  // Prefetch the next page in the background when the cursor approaches
  // the end of the loaded results, so navigating to the boundary doesn't
  // stall on a network round-trip.
  createEffect(() => {
    const rs = results();
    const idx = activeIndex();
    if (idx === 0 || rs.length === 0) return;
    if (!searchQuery.hasNextPage || searchQuery.isFetchingNextPage) return;
    if (rs.length - idx <= FIND_BAR_PREFETCH_THRESHOLD) {
      searchQuery.fetchNextPage();
    }
  });

  const next = () => {
    const rs = results();
    if (rs.length === 0) return;
    if (activeIndex() < rs.length) {
      const i = activeIndex() + 1;
      setActiveIndex(i);
      goToResult(rs[i - 1]);
      return;
    }
    // At the end of the loaded results — fetch the next page if available.
    // The `on(results)` effect below will navigate to the new tail item once
    // the fetch lands. If no next page, wrap.
    if (searchQuery.hasNextPage) {
      if (!searchQuery.isFetchingNextPage) {
        setActiveIndex(rs.length + 1);
        searchQuery.fetchNextPage();
      }
      return;
    }
    setActiveIndex(1);
    goToResult(rs[0]);
  };

  const previous = () => {
    const rs = results();
    if (rs.length === 0) return;
    const i = activeIndex() <= 1 ? rs.length : activeIndex() - 1;
    setActiveIndex(i);
    goToResult(rs[i - 1]);
  };

  const submit = () => {
    const trimmed = query().trim();
    setSubmittedQuery(validateSearchServiceText(trimmed) ? trimmed : '');
    options.clearSelection();
  };

  const open = () => {
    if (!isOpen()) {
      setIsOpen(true);
      return;
    }
    const el = inputEl();
    if (el && document.activeElement === el) {
      setIsOpen(false);
      return;
    }
    el?.focus();
    el?.select();
  };

  const close = () => {
    setIsOpen(false);
    setQuery('');
    setSubmittedQuery('');
    setActiveIndex(0);
  };

  const hasUnsubmittedChanges = () => query().trim() !== submittedQuery();
  const isPending = () => !!submittedQuery() && searchQuery.isFetching;

  return {
    isOpen,
    query,
    setQuery,
    submittedQuery,
    hasUnsubmittedChanges,
    isPending,
    activeIndex,
    resultsCount: () => results().length,
    open,
    close,
    submit,
    next,
    previous,
    setInputEl,
  };
}

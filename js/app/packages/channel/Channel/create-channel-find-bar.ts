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
    // While a new submitted-query is in flight, ignore the placeholder data
    // from the previous query so we don't auto-jump to a stale result.
    if (searchQuery.isFetching) return [];
    // NOTE: this guard prevents the Channel from blanking while the query is pending
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
    const i = activeIndex() >= rs.length ? 1 : activeIndex() + 1;
    setActiveIndex(i);
    goToResult(rs[i - 1]);
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

  // Closing the find bar treats the typed query as "unsubmitted" — the input
  // text is preserved so the user can see what they last searched, but
  // submittedQuery / activeIndex reset so reopening doesn't auto-navigate
  // off the user's current channel selection. They must hit Enter to
  // re-run the query.
  const close = () => {
    setIsOpen(false);
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

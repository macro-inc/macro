import { QUERY_FILTERS_BASE } from '@app/component/next-soup/filters/query-filters';
import { debouncedDependent } from '@core/util/debounce';
import {
  isChannelMessageEntity,
  type ChannelMessageEntity,
  type WithSearch,
} from '@entity';
import { useSearchSoupQuery } from '@queries/soup/search';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';

const FIND_BAR_DEBOUNCE_MS = 200;
const FIND_BAR_PAGE_SIZE = 50;

type CreateChannelFindBarOptions = {
  channelId: Accessor<string>;
  goToMessage: (messageId: string, replyId?: string) => void;
};

export type ChannelFindBar = ReturnType<typeof createChannelFindBar>;

export function createChannelFindBar(options: CreateChannelFindBarOptions) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [inputEl, setInputEl] = createSignal<HTMLInputElement>();

  const debouncedQuery = debouncedDependent(query, FIND_BAR_DEBOUNCE_MS);

  const searchQuery = useSearchSoupQuery(
    () => ({
      params: { page_size: FIND_BAR_PAGE_SIZE },
      body: {
        match_type: 'partial',
        query: debouncedQuery(),
        search_on: 'content',
        filters: {
          ...QUERY_FILTERS_BASE,
          channel_filters: { channel_ids: [options.channelId()] },
        },
      },
    }),
    () => ({ enabled: isOpen() })
  );

  const results = createMemo<WithSearch<ChannelMessageEntity>[]>(() => {
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

  // Reset index when the query changes so the next results batch starts at 1.
  createEffect(on(debouncedQuery, () => setActiveIndex(1), { defer: true }));

  // When results arrive, jump to the active index (clamped).
  createEffect(
    on(results, (rs) => {
      if (rs.length === 0) {
        setActiveIndex(0);
        return;
      }
      const next = Math.max(1, Math.min(activeIndex() || 1, rs.length));
      setActiveIndex(next);
      goToResult(rs[next - 1]);
    })
  );

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
  };

  return {
    isOpen,
    query,
    setQuery,
    activeIndex,
    resultsCount: () => results().length,
    open,
    close,
    next,
    previous,
    setInputEl,
  };
}

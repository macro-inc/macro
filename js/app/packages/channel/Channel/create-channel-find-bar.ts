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

  const close = () => {
    setIsOpen(false);
  };

  const hasUnsubmittedChanges = () => query().trim() !== submittedQuery();

  return {
    isOpen,
    query,
    setQuery,
    submittedQuery,
    hasUnsubmittedChanges,
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

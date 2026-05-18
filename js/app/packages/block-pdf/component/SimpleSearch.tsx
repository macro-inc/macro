import { searchLocationPendingSignal } from '@block-pdf/signal/location';
import type { FindBarController } from '@core/component/createFindBarController';
import { FindBar } from '@core/component/FindBar';
import { IS_MAC } from '@core/constant/isMac';
import { blockElementSignal } from '@core/signal/blockElement';
import { createEffect, createSignal, onCleanup, Show, untrack } from 'solid-js';
import {
  isSearchOpenSignal,
  searchSignal,
  useJumpToResult,
  useSearchClose,
  useSearchResults,
  useSearchStart,
} from '../signal/search';

export function SimpleSearch() {
  const searchStart = useSearchStart();
  const searchResults = useSearchResults();
  const jumpToResult = useJumpToResult();
  const closeSearchBar = useSearchClose();
  const locationPending = searchLocationPendingSignal.get;
  const [inputEl, setInputEl] = createSignal<HTMLInputElement>();

  const [isOpen, setIsOpen] = isSearchOpenSignal;
  const [searchText, setSearchText] = searchSignal;
  const [isPending, setIsPending] = createSignal(false);

  // Re-run the active search when the bar opens (or re-opens with prior text).
  createEffect(() => {
    if (untrack(locationPending)) return;
    const text = untrack(searchText);
    if (isOpen()) {
      searchStart({ query: text });
      if (text) setIsPending(true);
    }
  });

  // Sync the input value when the search subsystem normalizes/echoes a query.
  // Clear the pending flag once the results match the current query — guards
  // against the controller emitting a stale matchesCount mid-transition.
  createEffect(() => {
    const r = searchResults();
    if (untrack(locationPending)) return;
    if (r?.query != null) setSearchText(r.query);
    if (r?.query === untrack(searchText)) setIsPending(false);
  });

  const submittedQuery = () => searchResults()?.query ?? '';
  const total = () => searchResults()?.count.total ?? 0;
  const current = () => searchResults()?.count.current ?? 0;

  const submit = () => {
    const query = searchText();
    searchStart({ query });
    if (query) setIsPending(true);
  };

  const next = () => {
    const result = searchResults();
    if (!result || result.count.total === 0) return;
    const { matches, count } = result;
    const idx = count.current === count.total ? 0 : count.current;
    jumpToResult(matches[idx]);
  };

  const previous = () => {
    const result = searchResults();
    if (!result || result.count.total === 0) return;
    const { matches, count } = result;
    const idx = count.current === 1 ? count.total - 1 : count.current - 2;
    jumpToResult(matches[idx]);
  };

  const close = () => {
    closeSearchBar();
    setIsOpen(false);
  };

  // PDF.js owns the search state (queries, results, cursor). Expose it as a
  // FindBarController so it can drive the shared <FindBar> UI.
  const controller: FindBarController = {
    isOpen,
    query: searchText,
    setQuery: setSearchText,
    submittedQuery,
    activeIndex: current,
    hasUnsubmittedChanges: () => searchText() !== submittedQuery(),
    isPending,
    resultsCount: total,
    canNext: () => total() > 0,
    canPrevious: () => total() > 0,
    open: () => setIsOpen(true),
    close,
    submit,
    next,
    previous,
    setInputEl: (el) => setInputEl(el),
  };

  const handleHotkey = (e: KeyboardEvent) => {
    if (!((IS_MAC ? e.metaKey : e.ctrlKey) && e.key === 'f')) return;
    e.stopPropagation();
    e.preventDefault();
    const input = inputEl();
    if (isOpen()) {
      if (input === document.activeElement) {
        close();
      } else {
        input?.focus();
        input?.select();
      }
    } else {
      setIsOpen(true);
      input?.focus();
    }
  };

  const blockElement = blockElementSignal.get;
  createEffect(() => {
    const element = blockElement();
    if (!element) return;
    element.addEventListener('keydown', handleHotkey);
    document.addEventListener('keydown', handleHotkey);
    onCleanup(() => {
      element.removeEventListener('keydown', handleHotkey);
      document.removeEventListener('keydown', handleHotkey);
    });
  });

  return (
    <Show when={isOpen()}>
      <FindBar controller={controller} />
    </Show>
  );
}

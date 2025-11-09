import { IconButton } from '@core/component/IconButton';
import { IS_MAC } from '@core/constant/isMac';
import { blockElementSignal } from '@core/signal/blockElement';
import CaretDown from '@icon/regular/caret-down.svg';
import CaretUp from '@icon/regular/caret-up.svg';
import MagnifyingGlass from '@icon/regular/magnifying-glass.svg';
import X from '@icon/regular/x.svg';
import {
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import {
  isSearchOpenSignal,
  searchSignal,
  useJumpToResult,
  useSearchReset,
  useSearchResults,
  useSearchStart,
} from '../signal/search';

export function SimpleSearch() {
  const searchStart = useSearchStart();
  const searchResults = useSearchResults();
  const jumpToResult = useJumpToResult();
  const resetSearch = useSearchReset();
  let inputRef: HTMLInputElement | undefined;

  const [isSearching, setIsSearching] = createSignal(false);
  const [isOpen, setIsOpen] = isSearchOpenSignal;
  const [searchText, setSearchText] = searchSignal;

  // search on open
  createEffect(() => {
    const text = untrack(searchText);
    if (isOpen()) searchStart({ query: text });
  });

  createEffect(() => {
    const query = searchResults()?.query;
    if (query) {
      setSearchText(query);
    }

    if (searchResults()) {
      setIsSearching(false);
    }
  });

  const jumpTo = (dir: 'next' | 'prev') => {
    const result = searchResults();
    if (!result || result.count.total === 0) return;

    const {
      query,
      matches,
      count: { current, total },
    } = result;

    let index = 0;
    if (dir === 'next') {
      if (current === total) index = 0;
      else index = current;
    } else {
      if (current === 1) index = total - 1;
      else index = current - 2;
    }
    jumpToResult(matches[index]);

    if (searchText() !== query) {
      setSearchText(query);
    }
  };

  const closeSearch = () => {
    resetSearch();
    setIsOpen(false);
  };

  const inputKeyDownHandler: JSX.EventHandler<
    HTMLInputElement,
    KeyboardEvent
  > = (e) => {
    const query = searchText();
    const result = searchResults();
    if (e.key === 'Enter') {
      if (result && result.query === query) {
        if (e.shiftKey) {
          jumpTo('prev');
        } else {
          jumpTo('next');
        }
      } else {
        searchStart({ query });
        if (!query) return;
        setIsSearching(true);
      }
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  };

  const keyDownHandler = (e: KeyboardEvent) => {
    if ((IS_MAC ? e.metaKey : e.ctrlKey) && e.key === 'f') {
      e.stopPropagation();
      e.preventDefault();

      if (isOpen()) {
        if (inputRef === document.activeElement) {
          resetSearch();
          setIsOpen(false);
        } else {
          inputRef?.focus();
          inputRef?.select();
        }
      } else {
        setIsOpen(true);
        inputRef?.focus();
      }
    }
  };

  const blockElement = blockElementSignal.get;
  createEffect(() => {
    const element = blockElement();
    if (!element) return;

    // the document event listener will act as a fallback to handle all splits for when the block element is not in focus
    element.addEventListener('keydown', keyDownHandler);
    document.addEventListener('keydown', keyDownHandler);

    onCleanup(() => {
      element.removeEventListener('keydown', keyDownHandler);
      document.removeEventListener('keydown', keyDownHandler);
    });
  });

  return (
    <Show when={isOpen()}>
      <div class="flex items-center justify-start rounded-md border border-edge floating-hover p-1 focus-within:floating-input focus-within:border-accent">
        <div class="px-2">
          <MagnifyingGlass
            class={`size-4 ${isSearching() ? 'animate-pulse text-accent-ink' : 'text-ink '}`}
          />
        </div>
        <input
          class="mx-0.5 flex-1 border-0 text-sm text-ink focus:outline-none focus:ring-0"
          type="text"
          ref={inputRef}
          value={searchText()}
          onInput={(e) => setSearchText(e.target.value)}
          onKeyDown={inputKeyDownHandler}
        />
        <Show when={searchResults()}>
          {(result) => {
            const current = () => result().count.current;
            const total = () => result().count.total;

            return (
              <p class="flex-0 ml-auto mr-3 text-right w-24">
                {current()}/{total()}
              </p>
            );
          }}
        </Show>
        <Show when={!searchResults() && isSearching()}>
          <p class="flex-0 ml-auto mr-3 text-right w-24" />
        </Show>
        <IconButton
          icon={CaretUp}
          theme="clear"
          onClick={() => jumpTo('prev')}
        />
        <IconButton
          icon={CaretDown}
          theme="clear"
          onClick={() => jumpTo('next')}
        />
        <IconButton icon={X} theme="clear" onClick={closeSearch} />
      </div>
    </Show>
  );
}

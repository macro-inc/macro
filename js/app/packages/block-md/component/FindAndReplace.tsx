import { FindAndReplaceStore } from '@block-md/signal/findAndReplaceStore';
import { mdStore } from '@block-md/signal/markdownBlockData';
import {
  DO_REPLACE_COMMAND,
  DO_REPLACE_ONCE_COMMAND,
  DO_SEARCH_COMMAND,
} from '@core/component/LexicalMarkdown/plugins';
import type { FloatingStyle } from '@core/component/LexicalMarkdown/plugins/find-and-replace';
import { Tooltip } from '@core/component/Tooltip';
import { IS_MAC } from '@core/constant/isMac';
import { blockElementSignal } from '@core/signal/blockElement';
import { useCanEdit } from '@core/signal/permissions';
import ReplaceAll from '@icon/regular/arrow-bend-double-up-right.svg';
import Replace from '@icon/regular/arrow-bend-up-right.svg';
import CaretDown from '@icon/regular/caret-down.svg';
import CaretRight from '@icon/regular/caret-right.svg';
import CaretUp from '@icon/regular/caret-up.svg';
import MagnifyingGlass from '@icon/regular/magnifying-glass.svg';
import X from '@icon/regular/x.svg';
import { createCallback } from '@solid-primitives/rootless';
import type { JSX } from 'solid-js';
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js';

export function FindAndReplace() {
  const mdData = mdStore.get;
  const canEdit = useCanEdit();
  const editor = () => mdData.editor;
  const blockElement = blockElementSignal.get;

  let inputRef: HTMLInputElement | undefined;
  let inputReplaceRef: HTMLInputElement | undefined;
  let performSearchTimeout: ReturnType<typeof setTimeout>;

  const [findAndReplaceStore, setFindAndReplaceStore] = FindAndReplaceStore;

  const closeSearch = () => {
    setFindAndReplaceStore('searchIsOpen', false);
    setFindAndReplaceStore('isSearching', false);
    setFindAndReplaceStore('searchInputText', '');
    setFindAndReplaceStore('replaceInputOpen', false);
    setFindAndReplaceStore('replaceInputText', '');
    setFindAndReplaceStore('listOffset', []);
    setFindAndReplaceStore('styles', []);
    setFindAndReplaceStore('currentMatch', -1);
    setFindAndReplaceStore('currentQuery', '');
  };

  const toggleReplaceInput = () => {
    setFindAndReplaceStore(
      'replaceInputOpen',
      !findAndReplaceStore.replaceInputOpen
    );
  };

  const scrollToCurrentHighlight = (nextHighlight: boolean = false) => {
    const scrollContainer = mdData.scrollContainer;
    if (!scrollContainer) return;

    let highlightIndex: number = findAndReplaceStore.currentMatch;
    if (nextHighlight) {
      highlightIndex = (highlightIndex + 1) % findAndReplaceStore.styles.length;
    }

    const transform =
      findAndReplaceStore.styles?.[highlightIndex]?.style?.transform;
    const yPos = transform ? parseFloat(transform.split(',')[1]) : 0;

    scrollContainer.scrollTo({
      top: Math.max(0, yPos - 20),
      behavior: 'smooth',
    });
  };

  const [scrollToNext, setScrollToNext] = createSignal<boolean>(false);

  createEffect(
    on(scrollToNext, () => {
      const currentMatch: number = findAndReplaceStore.currentMatch;
      const styles: { style: FloatingStyle; idx: number | undefined }[] =
        findAndReplaceStore.styles;
      if (scrollToNext() && currentMatch === -1 && styles.length > 0) {
        let highlightToScrollTo: number = 0;
        const scrollContainer = mdData.scrollContainer;
        if (scrollContainer) {
          for (let i = 0; i < styles.length; i++) {
            const transform = styles?.[i]?.style?.transform;
            const yPos = transform ? parseFloat(transform.split(',')[1]) : 0;
            if (yPos >= scrollContainer.scrollTop - 100) {
              highlightToScrollTo = i;
              break;
            }
          }
        }
        setFindAndReplaceStore('currentMatch', highlightToScrollTo);
        scrollToCurrentHighlight();
        setScrollToNext(false);
      }
    })
  );

  const jumpTo = createCallback((dir: 'next' | 'prev', replace = false) => {
    const currentMatch: number = findAndReplaceStore.currentMatch;
    const matches = findAndReplaceStore.matches;
    if (matches === 0) return;

    let highlightToScrollTo: number = findAndReplaceStore.currentMatch;
    if (currentMatch === -1) {
      setScrollToNext(true);
      return;
    } else {
      if (dir === 'prev') {
        highlightToScrollTo =
          currentMatch <= 0 ? matches - 1 : currentMatch - 1;
        setFindAndReplaceStore('currentMatch', highlightToScrollTo);
      } else {
        if (!replace) {
          highlightToScrollTo =
            currentMatch >= matches - 1 ? 0 : currentMatch + 1;
          setFindAndReplaceStore('currentMatch', highlightToScrollTo);
        } else {
          setFindAndReplaceStore(
            'currentMatch',
            currentMatch >= matches - 1 ? 0 : highlightToScrollTo
          );
          highlightToScrollTo = (highlightToScrollTo + 1) % matches;
        }
      }
    }
    scrollToCurrentHighlight();
  });

  // Search

  const _performSearch = createCallback(async (jump: boolean) => {
    const query: string = findAndReplaceStore.searchInputText;
    if (!query) {
      setFindAndReplaceStore('listOffset', []);
      setFindAndReplaceStore('styles', []);
      setFindAndReplaceStore('currentQuery', '');
      setFindAndReplaceStore('currentMatch', -1);
      setFindAndReplaceStore('isSearching', false);
      return;
    }
    editor()?.dispatchCommand(DO_SEARCH_COMMAND, query);

    if (jump) {
      jumpTo('next');
    }
    setFindAndReplaceStore('currentQuery', query);
    setFindAndReplaceStore('isSearching', false);
  });

  const performSearch = (newQuery: boolean, debounced = true, jump = false) => {
    if (newQuery) {
      setFindAndReplaceStore('currentQuery', '');
      setFindAndReplaceStore('currentMatch', -1);
      setFindAndReplaceStore(
        'isSearching',
        !!findAndReplaceStore.searchInputText
      );
      setFindAndReplaceStore('listOffset', []);
      setFindAndReplaceStore('styles', []);
    }
    clearTimeout(performSearchTimeout);
    performSearchTimeout = setTimeout(
      () => {
        if (findAndReplaceStore.searchInputText) _performSearch(jump);
      },
      debounced ? 325 : 0
    );
  };

  // Replace at Index

  const replaceTextAtIndex = createCallback(() => {
    const replaceString = findAndReplaceStore.replaceInputText;
    if (!replaceString) {
      return;
    }

    if (replaceString === findAndReplaceStore.searchInputText) {
      return;
    }

    if (findAndReplaceStore.currentMatch === -1) {
      jumpTo('next');
      return;
    }

    scrollToCurrentHighlight(true);
    editor()?.dispatchCommand(DO_REPLACE_ONCE_COMMAND, {
      replaceString: replaceString,
      nodeKeyOffsetList: findAndReplaceStore.listOffset.filter(
        (offset) => offset.pairKey === findAndReplaceStore.currentMatch + 1
      ),
    });
  });

  // Replace All

  const replaceTextAll = createCallback(() => {
    const replaceString = findAndReplaceStore.replaceInputText;
    if (!replaceString) {
      return;
    }
    editor()?.dispatchCommand(DO_REPLACE_COMMAND, {
      replaceString: replaceString,
      nodeKeyOffsetList: findAndReplaceStore.listOffset,
    });
  });

  // Input Handlers

  const inputKeyDownHandler: JSX.EventHandler<HTMLInputElement, KeyboardEvent> =
    createCallback((e) => {
      if (e.key === 'Escape') {
        closeSearch();
        return;
      }
      const query: string = findAndReplaceStore.searchInputText;
      const matches = findAndReplaceStore.matches;
      if (!query) return;
      if (e.key === 'Enter') {
        if (matches > 0 && findAndReplaceStore.currentQuery === query) {
          if (e.shiftKey) {
            jumpTo('prev');
          } else {
            jumpTo('next');
          }
        } else {
          performSearch(true, false, true);
        }
      }
    });

  const keyDownHandler = (e: KeyboardEvent) => {
    if ((IS_MAC ? e.metaKey : e.ctrlKey) && e.key === 'f') {
      e.stopPropagation();
      e.preventDefault();
      if (findAndReplaceStore.searchIsOpen) {
        if (inputRef === document.activeElement) {
          closeSearch();
        } else {
          inputRef?.focus();
          inputRef?.select();
        }
      } else {
        setFindAndReplaceStore('searchIsOpen', true);
        inputRef?.focus();
      }
    }
  };

  const replaceKeyDownHandler: JSX.EventHandler<
    HTMLInputElement,
    KeyboardEvent
  > = createCallback((e) => {
    if (e.key === 'Escape') {
      closeSearch();
      return;
    }
    const query: string = findAndReplaceStore.searchInputText;
    if (!query) return;
    if (e.key === 'Enter') {
      if (findAndReplaceStore.currentMatch === -1) {
        jumpTo('next');
      } else if (findAndReplaceStore.matches > 0) {
        replaceTextAtIndex();
      }
    }
  });

  createEffect(() => {
    const element = blockElement();
    if (!element) return;
    element.addEventListener('keydown', keyDownHandler);
    document.addEventListener('keydown', keyDownHandler);
    onCleanup(() => {
      element.removeEventListener('keydown', keyDownHandler);
      document.removeEventListener('keydown', keyDownHandler);
    });
  });

  return (
    <Show when={findAndReplaceStore.searchIsOpen}>
      <div class="flex items-center justify-start rounded-md border border-edge bg-menu p-1 shadow w-fit">
        <div class="flex items-center px-1">
          <Tooltip
            tooltip={`${findAndReplaceStore.replaceInputOpen ? 'Collapse' : 'Expand'} Search Bar`}
          >
            <div
              class="flex items-center w-8 h-6 justify-center rounded-md hover:bg-hover hover-transition-bg"
              onMouseDown={toggleReplaceInput}
            >
              <Show when={canEdit()}>
                {findAndReplaceStore.replaceInputOpen ? (
                  <CaretDown class="size-3" />
                ) : (
                  <CaretRight class="size-3" />
                )}
              </Show>
              <MagnifyingGlass
                class={`size-4 ${findAndReplaceStore.isSearching ? 'animate-pulse text-accent-ink' : 'text-ink '}`}
              />
            </div>
          </Tooltip>
        </div>

        <div class="flex flex-col w-fit">
          <div class="flex items-center px-1">
            <div class="flex rounded-md border bg-input border-edge px-1 mx-1 w-58">
              <input
                class="mx-0.5 flex-1 h-6 border-0 text-sm text-ink focus:outline-none focus:ring-0"
                type="text"
                placeholder="Find..."
                ref={inputRef}
                value={findAndReplaceStore.searchInputText}
                onInput={(e) => {
                  setFindAndReplaceStore('searchInputText', e.target.value);
                  performSearch(true, true);
                }}
                onKeyDown={inputKeyDownHandler}
              />
            </div>
            <div class="flex ml-2">
              <div class="flex items-center justify-start">
                <p class="text-xs text-ink whitespace-nowrap">
                  {findAndReplaceStore.isSearching
                    ? 'searching...'
                    : findAndReplaceStore.matches > 0
                      ? `${findAndReplaceStore.currentMatch === -1 ? '?' : findAndReplaceStore.currentMatch + 1} of ${findAndReplaceStore.matches}` +
                        ` match${findAndReplaceStore.matches === 1 ? '' : 'es'}`
                      : 'no matches'}
                </p>
              </div>
              <div class=" ml-4 flex justify-end items-center">
                <Tooltip tooltip={`Previous Match`}>
                  <div
                    class="flex items-center px-1 w-6 h-6 justify-center rounded-md hover:bg-hover hover-transition-bg"
                    onMouseDown={() => {
                      jumpTo('prev');
                    }}
                  >
                    <CaretUp />
                  </div>
                </Tooltip>
                <Tooltip tooltip={`Next Match`}>
                  <div
                    class="flex items-center px-1 w-6 h-6 justify-center rounded-md hover:bg-hover hover-transition-bg"
                    onMouseDown={() => {
                      jumpTo('next');
                    }}
                  >
                    <CaretDown />
                  </div>
                </Tooltip>
                <Tooltip tooltip={`Close Search Bar`}>
                  <div
                    class="flex items-center px-1 w-6 h-6 justify-center rounded-md hover:bg-hover hover-transition-bg"
                    onMouseDown={closeSearch}
                  >
                    <X />
                  </div>
                </Tooltip>
              </div>
            </div>
          </div>

          <Show when={findAndReplaceStore.replaceInputOpen && canEdit()}>
            <div class="flex items-center px-1">
              <div class="flex rounded-md border bg-input border-edge px-1 mx-1 mt-1 w-58">
                <input
                  class="mx-0.5 flex-1 h-6 border-0 text-sm text-ink focus:outline-none focus:ring-0"
                  type="text"
                  placeholder="Replace with..."
                  ref={inputReplaceRef}
                  value={findAndReplaceStore.replaceInputText}
                  onInput={(e) =>
                    setFindAndReplaceStore('replaceInputText', e.target.value)
                  }
                  onKeyDown={replaceKeyDownHandler}
                />
              </div>
              <div class="flex flex-grow justify-center ml-2">
                <Tooltip tooltip={`Replace`}>
                  <div
                    class="flex items-center px-1 w-6 h-6 justify-center rounded-md hover:bg-hover hover-transition-bg"
                    onMouseDown={() => {
                      replaceTextAtIndex();
                    }}
                  >
                    <Replace />
                  </div>
                </Tooltip>
                <Tooltip tooltip={`Replace All`}>
                  <div
                    class="flex items-center px-1 w-6 h-6 justify-center rounded-md hover:bg-hover hover-transition-bg"
                    onMouseDown={() => {
                      replaceTextAll();
                    }}
                  >
                    <ReplaceAll />
                  </div>
                </Tooltip>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}

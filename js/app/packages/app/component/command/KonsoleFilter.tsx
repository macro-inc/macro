import { TextButton } from '@core/component/TextButton';
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  commandCategoryIndex,
  SEARCH_CATEGORY,
  setCommandCategoryIndex,
} from './KonsoleItem';
import { currentKonsoleMode, konsoleOpen } from './state';

export function KonsoleFilter() {
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const buttonRefs: HTMLDivElement[] = [];

  onMount(() => {
    const down = (e: KeyboardEvent) => {
      if (!konsoleOpen()) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        setCommandCategoryIndex((prev) => {
          let nextCategoryIndex = -1;
          if (e.shiftKey) {
            nextCategoryIndex = findNextCategoryIndex(prev, true);
          } else {
            nextCategoryIndex = findNextCategoryIndex(prev, false);
          }
          return Math.max(nextCategoryIndex, 0);
        });
      }
    };

    document.addEventListener('keydown', down);
    onCleanup(() => {
      document.removeEventListener('keydown', down);
    });
  });

  function isCategoryActive(category: number): boolean {
    if (SEARCH_CATEGORY[category] === 'Emails') {
      // only use emails for the search bar
      if (currentKonsoleMode() !== 'FULL_TEXT_SEARCH') return false;

      // TODO only show emails if they are enabled
      // NOTE: this also seems to trigger a "computations created outside a 'createRoot' will never be disposed error
      //const emailActive = useEmailActive();
      const emailEnabled = () => {
        // TODO: this causes a loop
        //if (emailActive()?.link_exists) return true;
        return true;
      };
      return emailEnabled();
    }
    return true;
  }

  function findNextCategoryIndex(category: number, backwards: boolean): number {
    let candidateCategory = -1;
    for (let i = 1; i < SEARCH_CATEGORY.length; i++) {
      if (backwards) {
        candidateCategory = category - i;
      } else {
        candidateCategory = category + i;
      }

      // Perform wrap-around
      if (candidateCategory >= SEARCH_CATEGORY.length) {
        candidateCategory = 0;
      } else if (candidateCategory < 0) {
        candidateCategory = SEARCH_CATEGORY.length + candidateCategory;
      }

      if (isCategoryActive(candidateCategory)) break;
      candidateCategory = -1;
    }
    return candidateCategory;
  }

  // Scroll selected category into view when selection changes
  createEffect(() => {
    const container = containerRef();
    const selectedIndex = commandCategoryIndex();

    if (container && buttonRefs[selectedIndex]) {
      const selectedButtonDiv = buttonRefs[selectedIndex];

      // Use requestAnimationFrame to ensure DOM updates are complete
      requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect();
        const buttonRect = selectedButtonDiv.getBoundingClientRect();

        const isFullyVisible =
          buttonRect.left >= containerRect.left &&
          buttonRect.right <= containerRect.right;

        if (!isFullyVisible) {
          // For rightmost items like "Companies", scroll to show them fully
          // Add some padding so the button isn't right at the edge
          const scrollLeft =
            selectedButtonDiv.offsetLeft -
            container.clientWidth +
            selectedButtonDiv.offsetWidth +
            8;
          container.scrollTo({
            left: Math.max(0, scrollLeft),
            behavior: 'smooth',
          });
        }
      });
    }
  });

  return (
    <div
      ref={setContainerRef}
      class="flex pb-4 overflow-x-auto scrollbar-hidden bg-transparent"
    >
      <For each={SEARCH_CATEGORY}>
        {(item, index) => (
          <Show when={isCategoryActive(index())}>
            <TextButton
              ref={(el) => {
                if (el) buttonRefs[index()] = el;
              }}
              theme={
                index() === commandCategoryIndex() ? 'accentFill' : 'clear'
              }
              text={item}
              onMouseDown={() => setCommandCategoryIndex(index())}
              class="flex-shrink-0 h-auto *:h-7 *:px-2"
            />
          </Show>
        )}
      </For>
    </div>
  );
}

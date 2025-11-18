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
  searchCategories,
  setCommandCategoryIndex,
} from './KonsoleItem';
import { konsoleOpen } from './state';

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
            nextCategoryIndex = searchCategories.findNextCategoryIndex(
              prev,
              true
            );
          } else {
            nextCategoryIndex = searchCategories.findNextCategoryIndex(
              prev,
              false
            );
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
      <For each={searchCategories.listVisible()}>
        {(item, index) => (
          <Show when={searchCategories.isCategoryActive(index())}>
            <TextButton
              ref={(el) => {
                if (el) buttonRefs[index()] = el;
              }}
              theme={
                index() === commandCategoryIndex() ? 'accentFill' : 'clear'
              }
              text={item.name}
              onMouseDown={() => setCommandCategoryIndex(index())}
              class="flex-shrink-0 h-auto *:h-7 *:px-2"
            />
          </Show>
        )}
      </For>
    </div>
  );
}

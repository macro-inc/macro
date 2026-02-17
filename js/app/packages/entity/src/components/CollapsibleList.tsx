import { For, Show, createSignal, type JSX } from 'solid-js';
import ChevronDownIcon from '@icon/regular/caret-down.svg?component-solid';
import { cn } from '@ui/utils/classname';

interface CollapsibleListProps<T> {
  items: T[];
  visibleCount?: number;
  children: (item: T, index?: number, count?: number) => JSX.Element;
  expandText?: (count: number) => string;
}

/**
 * Generic collapsible list component
 * - Shows a limited number of items initially
 * - Provides "Show N more" / "Collapse" buttons
 * - Supports thread border for visual hierarchy
 *
 * NOTE: This component uses <For> which compares items by referential equality.
 * If items array is recreated with new object references on every render,
 * all children will remount. To prevent this, ensure stable object references
 * in the parent component using reconcile() or proper memoization.
 */
export function CollapsibleList<T>(props: CollapsibleListProps<T>) {
  const [showAll, setShowAll] = createSignal(false);
  const visibleCount = () => props.visibleCount ?? 3;

  const visibleItems = () => {
    if (props.items.length <= visibleCount() || showAll()) {
      return props.items;
    }
    return props.items.slice(0, visibleCount());
  };

  const count = () => props.items.length;
  const hasMore = () => props.items.length > visibleCount();

  const getExpandTextFn = () =>
    props.expandText ?? ((count: number) => `Show ${count} More`);

  return (
    <>
      <For each={visibleItems()}>
        {(child, index) => props.children(child, index(), count())}
      </For>
      <Show when={hasMore()}>
        <div class="w-full flex items-center gap-2 my-2">
          <button
            type="button"
            class="flex items-center gap-1 text-xs bracket-never hover:text-accent"
            onClick={(e) => {
              e.stopPropagation();
              setShowAll((prev) => !prev);
            }}
          >
            <ChevronDownIcon
              class={cn('w-3 h-3 transition-transform duration-100', {
                'rotate-180': showAll(),
              })}
            />
            <Show when={!showAll()} fallback="Collapse">
              {getExpandTextFn()(props.items.length - visibleCount())}
            </Show>
          </button>
          <div class="border-t border-edge-muted/50 grow"></div>
        </div>
      </Show>
    </>
  );
}

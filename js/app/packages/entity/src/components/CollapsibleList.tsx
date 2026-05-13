import ChevronDownIcon from '@icon/regular/caret-down.svg?component-solid';
import { cn } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';

interface ToggleButtonProps {
  hasMore: boolean;
  showAll: boolean;
  toggle: (e: MouseEvent) => void;
  getExpandTextFn: (count: number) => string;
  visibleCount: number;
  itemsLength: number;
}

function ToggleButton(props: ToggleButtonProps) {
  return (
    <Show when={props.hasMore}>
      <div class="px-3 py-1.5">
        <button
          type="button"
          class="flex items-center gap-1 text-[0.6875rem] text-ink-muted/70 hover:text-ink-muted"
          data-collapsible-toggle
          data-collapsible-state={props.showAll ? 'expanded' : 'collapsed'}
          onClick={props.toggle}
        >
          <ChevronDownIcon
            class={cn('size-2.5', {
              'rotate-180': props.showAll,
            })}
          />
          <Show when={!props.showAll} fallback="Show less">
            {props.getExpandTextFn(props.itemsLength - props.visibleCount)}
          </Show>
        </button>
      </div>
    </Show>
  );
}

interface CollapsibleListProps<T> {
  items: T[];
  visibleCount?: number;
  children: (item: T, index?: number, count?: number) => JSX.Element;
  expandText?: (count: number) => string;
  togglePosition?: 'top' | 'bottom';
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
  const position = () => props.togglePosition ?? 'top';

  const getExpandTextFn = () =>
    props.expandText ?? ((count: number) => `Show ${count} More`);

  // Let the virtualizer (virtua) handle scroll anchoring on item resize via
  // its built-in ACTION_ITEM_RESIZE logic and overflow-anchor: none. Manually
  // shifting scrollTop here fights that logic and causes the viewport to
  // drift across expand/collapse cycles.
  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    setShowAll((prev) => !prev);
  };

  const toggleButtonProps = () => ({
    hasMore: hasMore(),
    showAll: showAll(),
    toggle,
    getExpandTextFn: getExpandTextFn(),
    visibleCount: visibleCount(),
    itemsLength: props.items.length,
  });

  return (
    <>
      <Show when={position() === 'top'}>
        <ToggleButton {...toggleButtonProps()} />
      </Show>
      <For each={visibleItems()}>
        {(child, index) => props.children(child, index(), count())}
      </For>
      <Show when={position() === 'bottom'}>
        <ToggleButton {...toggleButtonProps()} />
      </Show>
    </>
  );
}

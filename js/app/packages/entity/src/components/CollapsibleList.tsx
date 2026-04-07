import ChevronDownIcon from '@icon/regular/caret-down.svg?component-solid';
import { cn } from '@ui/utils/classname';
import { createSignal, For, type JSX, Show } from 'solid-js';

interface ToggleButtonProps {
  hasMore: boolean;
  toggleRef: (el: HTMLDivElement) => void;
  showAll: boolean;
  collapse: (e: MouseEvent) => void;
  setShowAll: (value: boolean) => void;
  getExpandTextFn: (count: number) => string;
  visibleCount: number;
  itemsLength: number;
}

function ToggleButton(props: ToggleButtonProps) {
  return (
    <Show when={props.hasMore}>
      <div ref={props.toggleRef} class="w-full flex items-center gap-2 my-2">
        <button
          type="button"
          class="flex items-center gap-1 text-xs bracket-never hover:text-accent"
          data-collapsible-toggle
          data-collapsible-state={props.showAll ? 'expanded' : 'collapsed'}
          onClick={(e) => {
            if (props.showAll) {
              props.collapse(e);
            } else {
              e.stopPropagation();
              props.setShowAll(true);
            }
          }}
        >
          <ChevronDownIcon
            class={cn('w-3 h-3 transition-transform duration-100', {
              'rotate-180': props.showAll,
            })}
          />
          <Show when={!props.showAll} fallback="Collapse">
            {props.getExpandTextFn(props.itemsLength - props.visibleCount)}
          </Show>
        </button>
        <div class="border-t border-edge-muted/50 grow" />
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
  let toggleRef: HTMLDivElement | undefined;

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

  const getScrollParent = (el: Element | null): Element | null => {
    let parent = el?.parentElement ?? null;
    while (parent) {
      const { overflow, overflowY } = getComputedStyle(parent);
      if (/auto|scroll/.test(`${overflow}${overflowY}`)) return parent;
      parent = parent.parentElement;
    }
    return null;
  };

  const collapse = (e: MouseEvent) => {
    e.stopPropagation();

    const entity = toggleRef?.closest('[data-entity]');
    const scrollContainer = entity ? getScrollParent(entity) : null;
    const heightBefore = entity?.getBoundingClientRect().height ?? 0;

    setShowAll(false);

    if (entity && scrollContainer) {
      const heightAfter = entity.getBoundingClientRect().height;
      scrollContainer.scrollTop -= heightBefore - heightAfter;
    }
  };

  const toggleButtonProps = () => ({
    hasMore: hasMore(),
    toggleRef: (el: HTMLDivElement) => {
      toggleRef = el;
    },
    showAll: showAll(),
    collapse,
    setShowAll,
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

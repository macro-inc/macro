import { Tabs } from '@kobalte/core/tabs';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Plus from '@phosphor/plus.svg';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import {
  type ComponentProps,
  createSignal,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  splitProps,
} from 'solid-js';
import { cn } from '../utils/classname';
import { Button } from './Button';
import { Dropdown } from './Dropdown';
import { Layer } from './Layer';

export type TabSelectorProps = ParentProps<{ class?: string }>;

/**
 * Inset navigation with a scrollable track and a fixed, independently focused add menu.
 * @do Compose List and Tab inside Kobalte Tabs to retain keyboard navigation and selection semantics.
 * @do Give List an accessible label and provide tooltips for truncated tab names.
 * @dont Put AddMenu inside the tab collection; keep it beside Tabs so it remains independently focusable.
 */
export function TabSelector(props: TabSelectorProps) {
  return (
    <Layer depth={0}>
      <div
        class={cn(
          'flex min-w-0 items-center rounded-full border border-edge-muted bg-surface p-0.5',
          props.class
        )}
      >
        {props.children}
      </div>
    </Layer>
  );
}

function List(props: ComponentProps<typeof Tabs.List>) {
  const [local, rest] = splitProps(props, ['ref', 'class', 'children']);
  const [rail, setRail] = createSignal<HTMLDivElement>();
  const [left, setLeft] = createSignal(false);
  const [right, setRight] = createSignal(false);
  const measure = () => {
    const element = rail();
    if (!element) return;
    setLeft(element.scrollLeft > 1);
    setRight(
      element.scrollLeft + element.clientWidth < element.scrollWidth - 1
    );
  };
  const scroll = (direction: number) => {
    const element = rail();
    if (element) element.scrollLeft += direction * element.clientWidth * 0.75;
  };
  createResizeObserver(rail, measure);
  onMount(() => {
    const element = rail();
    if (!element) return;
    const observer = new MutationObserver(measure);
    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    onCleanup(() => observer.disconnect());
    measure();
  });
  return (
    <div class="flex min-w-0 items-center">
      <Show when={left() || right()}>
        <Button
          size="icon-sm"
          label="Scroll tabs left"
          class="shrink-0 rounded-full"
          disabled={!left()}
          onClick={() => scroll(-1)}
        >
          <CaretLeft class="size-3" />
        </Button>
      </Show>
      <Tabs.List
        {...rest}
        ref={(element) => {
          setRail(element);
          if (typeof local.ref === 'function') local.ref(element);
        }}
        class={cn(
          'relative flex min-w-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          local.class
        )}
        onScroll={measure}
        onWheel={(event: WheelEvent & { currentTarget: HTMLDivElement }) => {
          const element = event.currentTarget;
          if (
            event.ctrlKey ||
            event.metaKey ||
            event.deltaX ||
            !event.deltaY ||
            element.scrollWidth <= element.clientWidth
          )
            return;
          const before = element.scrollLeft;
          element.scrollLeft += event.deltaY;
          if (element.scrollLeft !== before) event.preventDefault();
        }}
        onFocusIn={(event) => {
          const element = event.target.closest<HTMLElement>(
            '[role="tab"], input'
          );
          if (!element) return;
          const viewport = event.currentTarget.getBoundingClientRect();
          const item = element.getBoundingClientRect();
          if (item.left < viewport.left)
            event.currentTarget.scrollLeft += item.left - viewport.left;
          else if (item.right > viewport.right)
            event.currentTarget.scrollLeft += item.right - viewport.right;
        }}
      >
        {local.children}
      </Tabs.List>
      <Show when={left() || right()}>
        <Button
          size="icon-sm"
          label="Scroll tabs right"
          class="shrink-0 rounded-full"
          disabled={!right()}
          onClick={() => scroll(1)}
        >
          <CaretRight class="size-3" />
        </Button>
      </Show>
    </div>
  );
}

function Tab(props: ComponentProps<typeof Tabs.Trigger>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Layer depth={2}>
      <Tabs.Trigger
        {...rest}
        class={cn(
          'relative flex max-w-40 shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-ink-extra-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50 data-selected:bg-surface data-selected:text-ink data-selected:ring data-selected:ring-inset data-selected:ring-edge-muted data-selected:shadow-sm',
          local.class
        )}
      />
    </Layer>
  );
}

function AddMenu(
  props: ParentProps<{
    label: string;
    ref?: (element: HTMLButtonElement) => void;
    onCloseAutoFocus?: (event: Event) => void;
  }>
) {
  return (
    <div class="ml-0.5 shrink-0 pl-0.5">
      <Dropdown>
        <Dropdown.Trigger
          ref={props.ref}
          size="icon-sm"
          class="rounded-full"
          aria-label={props.label}
        >
          <Plus class="size-3.5" />
        </Dropdown.Trigger>
        <Dropdown.Content onCloseAutoFocus={props.onCloseAutoFocus}>
          {props.children}
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}

TabSelector.List = List;
TabSelector.Tab = Tab;
TabSelector.AddMenu = AddMenu;

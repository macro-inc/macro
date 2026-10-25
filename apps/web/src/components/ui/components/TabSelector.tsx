import { isTouchDevice } from '@core/mobile/isTouchDevice';
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
 * Tabs that own panels or a dynamic collection: a scrollable row of the same
 * pills as `Tabs`, with an optional add menu that stays at the end.
 * @do Wrap the List and its Panels in `TabSelector.Root`; it owns selection and tab/tabpanel semantics.
 * @do Give List an accessible label and provide tooltips for truncated tab names.
 * @do Use for tables, forms, and editor sections whose tabs control `TabSelector.Panel`s.
 * @dont Use for a plain view switch with no panels; use `Tabs`.
 * @dont Put AddMenu inside the tab collection; keep it beside List so it remains independently focusable.
 * @dont Put a TabSelector inside a HeaderActionGroup or ButtonGroup.
 */
export function TabSelector(props: TabSelectorProps) {
  return (
    <Layer depth={0}>
      <div
        class={cn(
          'flex min-w-0 items-center',
          // Touch keeps its inset track; desktop tabs are separate pills.
          'touch:rounded-full touch:border touch:border-edge-muted touch:bg-surface touch:p-0.5',
          props.class
        )}
      >
        {props.children}
      </div>
    </Layer>
  );
}

/** Owns the selected tab; wrap the List and every Panel it controls. */
function Root(props: ComponentProps<typeof Tabs>) {
  return <Tabs {...props} />;
}

/** Content shown while its tab is selected. */
function Panel(props: ComponentProps<typeof Tabs.Content>) {
  return <Tabs.Content {...props} />;
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
          // Desktop padding keeps the pills' outline rings inside the scroll clip.
          'relative flex min-w-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] not-touch:-m-1 not-touch:gap-1.5 not-touch:p-1 [&::-webkit-scrollbar]:hidden',
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
          'relative flex max-w-40 shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap outline-none',
          'touch:px-3 touch:py-1 touch:text-xs touch:text-ink-extra-muted touch:hover:text-ink touch:focus-visible:ring-2 touch:focus-visible:ring-accent/50 touch:data-selected:bg-surface touch:data-selected:text-ink touch:data-selected:ring touch:data-selected:ring-inset touch:data-selected:ring-edge-muted touch:data-selected:shadow-sm',
          // Desktop matches a `Tabs` pill: the outline Button frame, pressed fill when selected.
          'not-touch:h-8 not-touch:border not-touch:bg-control not-touch:px-3 not-touch:text-sm not-touch:text-ink-muted not-touch:elevated not-touch:transition-colors not-touch:duration-120 motion-reduce:transition-none',
          'not-touch:not-data-selected:hover:overlay-hover not-touch:not-data-selected:hover:text-ink',
          'not-touch:data-selected:border-edge-button not-touch:data-selected:overlay-active not-touch:data-selected:text-ink not-touch:data-selected:shadow-none',
          'not-touch:focus-visible:ring-2 not-touch:focus-visible:ring-inset not-touch:focus-visible:ring-edge-focus',
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
    <div class="ml-0.5 shrink-0 pl-0.5 not-touch:ml-1.5 not-touch:pl-0">
      <Dropdown>
        <Dropdown.Trigger
          ref={props.ref}
          size={isTouchDevice() ? 'icon-sm' : 'icon-md'}
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

TabSelector.Root = Root;
TabSelector.List = List;
TabSelector.Tab = Tab;
TabSelector.Panel = Panel;
TabSelector.AddMenu = AddMenu;

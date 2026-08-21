import {
  type Accessor,
  children,
  createEffect,
  createSelector,
  createSignal,
  For,
  type JSX,
  type ParentProps,
  type Setter,
  Show,
  splitProps,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../utils/classname';
import { Panel } from './Panel';
import type { SurfaceProps } from './Surface';

type SelectedIndexSetter = Setter<number>;

export type CommandListController<T> = {
  selectedIndex: Accessor<number>;
  setSelectedIndex: (
    next: number | ((previous: number) => number),
    options?: { scrollIntoView?: boolean }
  ) => void;
  setSelectedIndexFromPointer: (index: number) => void;
  isSelected: (index: number) => boolean;
  selectedItem: Accessor<T | undefined>;
  selectSelected: () => boolean;
  selectNext: () => boolean;
  selectPrevious: () => boolean;
  shouldScrollSelectedIntoView: Accessor<boolean>;
};

export function createCommandListController<T>(options: {
  items: Accessor<readonly T[]>;
  selectedIndex?: Accessor<number>;
  setSelectedIndex?: SelectedIndexSetter;
  onSelect?: (item: T, index: number) => void;
}): CommandListController<T> {
  const [internalSelectedIndex, setInternalSelectedIndex] = createSignal(0);
  const [shouldScrollSelectedIntoView, setShouldScrollSelectedIntoView] =
    createSignal(false);

  const selectedIndex = options.selectedIndex ?? internalSelectedIndex;
  const setRawSelectedIndex =
    options.setSelectedIndex ?? setInternalSelectedIndex;

  const setSelectedIndex = (
    next: number | ((previous: number) => number),
    options?: { scrollIntoView?: boolean }
  ) => {
    setShouldScrollSelectedIntoView(Boolean(options?.scrollIntoView));
    setRawSelectedIndex(next);
  };

  createEffect(() => {
    const items = options.items();
    const current = selectedIndex();

    if (items.length === 0) {
      if (current !== 0) setSelectedIndex(0);
      return;
    }

    if (current >= items.length) {
      setSelectedIndex(items.length - 1);
    }
  });

  const selectedItem = () => options.items()[selectedIndex()];
  const isSelected = createSelector(selectedIndex);

  const selectNext = () => {
    const items = options.items();
    if (items.length === 0) return false;

    setSelectedIndex((previous) => (previous + 1) % items.length, {
      scrollIntoView: true,
    });
    return true;
  };

  const selectPrevious = () => {
    const items = options.items();
    if (items.length === 0) return false;

    setSelectedIndex(
      (previous) => (previous - 1 + items.length) % items.length,
      { scrollIntoView: true }
    );
    return true;
  };

  const selectSelected = () => {
    const index = selectedIndex();
    const item = options.items()[index];
    if (!item) return false;

    options.onSelect?.(item, index);
    return true;
  };

  return {
    selectedIndex,
    setSelectedIndex,
    setSelectedIndexFromPointer: (index) => setSelectedIndex(index),
    isSelected,
    selectedItem,
    selectSelected,
    selectNext,
    selectPrevious,
    shouldScrollSelectedIntoView,
  };
}

function CommandMenuShellRoot(props: SurfaceProps) {
  const [local, rest] = splitProps(props, ['children', 'class']);

  return (
    <Panel
      class={cn('max-h-[75vh] rounded-xl bg-dialog', local.class)}
      {...rest}
    >
      {local.children}
    </Panel>
  );
}

function CommandMenuHeader(props: ParentProps<{ class?: string }>) {
  return (
    <Panel.Header class={cn('gap-2 px-4 my-1', props.class)}>
      {props.children}
    </Panel.Header>
  );
}

function CommandMenuToolbar(props: ParentProps<{ class?: string }>) {
  return (
    <Panel.Toolbar class={cn('bg-dialog', props.class)}>
      {props.children}
    </Panel.Toolbar>
  );
}

function CommandMenuBody(
  props: ParentProps<{ class?: string; scroll?: boolean }>
) {
  return (
    <Panel.Body class={props.class} scroll={props.scroll}>
      {props.children}
    </Panel.Body>
  );
}

function CommandMenuFooter(props: ParentProps<{ class?: string }>) {
  return (
    <Panel.Footer
      class={cn(
        'gap-4 px-4 bg-dialog text-xs text-ink-extra-muted/80',
        props.class
      )}
    >
      {props.children}
    </Panel.Footer>
  );
}

export const CommandMenuShell = Object.assign(CommandMenuShellRoot, {
  Header: CommandMenuHeader,
  Toolbar: CommandMenuToolbar,
  Body: CommandMenuBody,
  Footer: CommandMenuFooter,
});

export function CommandMenuList<T>(props: {
  items: readonly T[];
  selectedIndex: number;
  scrollSelectedIntoView?: boolean;
  class?: string;
  itemId?: (item: T, index: number) => string;
  itemDisabled?: (item: T, index: number) => boolean;
  beforeItem?: (item: T, index: number) => JSX.Element;
  onSelect: (item: T, index: number, event: MouseEvent) => void;
  onItemMouseMove?: (index: number, item: T) => void;
  children: (item: T, index: Accessor<number>) => JSX.Element;
}) {
  let listRef: HTMLDivElement | undefined;
  let lastMousePosition: { x: number; y: number } | undefined;
  let suppressPointerSelectionUntil = 0;

  const isSelected = createSelector(() => props.selectedIndex);

  const itemId = (item: T, index: number) =>
    props.itemId?.(item, index) ?? `command-menu-list-item-${index}`;

  createEffect(() => {
    const index = props.selectedIndex;
    const item = props.items[index];

    if (!props.scrollSelectedIntoView || !listRef || !item) return;

    suppressPointerSelectionUntil = performance.now() + 250;
    const elem = document.getElementById(itemId(item, index));
    elem?.scrollIntoView({ block: 'nearest' });
  });

  const handleMouseMove = (event: MouseEvent, item: T, index: number) => {
    const mousePosition = { x: event.clientX, y: event.clientY };
    const isFirstMouseMove = lastMousePosition === undefined;
    const moved =
      lastMousePosition !== undefined &&
      (lastMousePosition.x !== mousePosition.x ||
        lastMousePosition.y !== mousePosition.y);

    lastMousePosition = mousePosition;

    if (performance.now() < suppressPointerSelectionUntil) return;

    if (moved || isFirstMouseMove) {
      props.onItemMouseMove?.(index, item);
    }
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      class={cn(
        'max-h-54 overflow-y-auto overflow-x-hidden scrollbar-hidden p-2',
        props.class
      )}
      onScroll={() => {
        suppressPointerSelectionUntil = performance.now() + 120;
      }}
    >
      <For each={props.items}>
        {(item, index) => (
          <>
            {props.beforeItem?.(item, index())}
            <CommandMenuListItem
              as="div"
              id={itemId(item, index())}
              selected={isSelected(index())}
              disabled={props.itemDisabled?.(item, index())}
              class="scroll-m-2"
              onClick={(event) => props.onSelect(item, index(), event)}
              onMouseMove={(event) => handleMouseMove(event, item, index())}
            >
              {props.children(item, index)}
            </CommandMenuListItem>
          </>
        )}
      </For>
    </div>
  );
}

export function CommandMenuSearchInput(
  props: JSX.InputHTMLAttributes<HTMLInputElement>
) {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <input
      class={cn(
        'flex-1 bg-transparent border-0 outline-none focus:outline-none ring-0 focus:ring-0 text-ink-muted placeholder:text-ink-placeholder',
        local.class
      )}
      {...rest}
    />
  );
}

export function CommandMenuListItem(
  props: ParentProps<{
    id?: string;
    as?: 'button' | 'div';
    class?: string;
    selected?: boolean;
    disabled?: boolean;
    onClick?: JSX.EventHandlerUnion<HTMLElement, MouseEvent>;
    onMouseMove?: JSX.EventHandlerUnion<HTMLElement, MouseEvent>;
  }>
) {
  return (
    <Dynamic
      component={props.as ?? 'button'}
      type={props.as === 'div' ? undefined : 'button'}
      id={props.id}
      disabled={props.as === 'div' ? undefined : props.disabled}
      aria-disabled={props.disabled || undefined}
      class={cn(
        'rounded-md group w-full flex items-center h-10 px-2 gap-2 text-sm font-semibold relative scroll-m-1 text-left disabled:opacity-50 disabled:pointer-events-none',
        props.disabled && 'opacity-50 pointer-events-none',
        props.selected && 'bg-active',
        props.class
      )}
      onClick={props.onClick}
      onMouseMove={props.onMouseMove}
    >
      {props.children}
    </Dynamic>
  );
}

export function CommandMenuEmptyState(
  props: ParentProps<{ class?: string; children: JSX.Element }>
) {
  const resolved = children(() => props.children);

  return (
    <Show when={resolved()}>
      <div class={cn('p-4 text-center text-ink-muted text-sm', props.class)}>
        {resolved()}
      </div>
    </Show>
  );
}

export function CommandMenuHotkeyHint(
  props: ParentProps<{
    class?: string;
    hotkey: JSX.Element;
    label: JSX.Element;
  }>
) {
  return (
    <span class={cn('flex items-center gap-1', props.class)}>
      <div class="flex border border-edge-muted text-xxs rounded-md items-center px-1.5 py-px font-normal">
        {props.hotkey}
      </div>
      {props.label}
    </span>
  );
}

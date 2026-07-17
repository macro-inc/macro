import {
  type Accessor,
  children,
  createEffect,
  createSelector,
  createSignal,
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
    <Panel class={cn('max-h-[75vh] rounded-xl', local.class)} {...rest}>
      {local.children}
    </Panel>
  );
}

function CommandMenuHeader(props: ParentProps<{ class?: string }>) {
  return (
    <Panel.Header class={cn('gap-2 px-2 my-1 bg-surface', props.class)}>
      {props.children}
    </Panel.Header>
  );
}

function CommandMenuToolbar(props: ParentProps<{ class?: string }>) {
  return (
    <Panel.Toolbar class={cn('bg-surface', props.class)}>
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
        'gap-4 px-4 bg-surface text-xs text-ink-extra-muted/80',
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
      disabled={props.disabled}
      class={cn(
        'rounded-md group w-full flex items-center h-10 px-2 gap-2 text-sm font-semibold relative scroll-m-1 text-left disabled:opacity-50 disabled:pointer-events-none',
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

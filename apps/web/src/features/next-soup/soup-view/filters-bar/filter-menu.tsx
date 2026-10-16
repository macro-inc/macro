import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { debounce } from '@solid-primitives/scheduled';
import { cn, Dropdown } from '@ui';
import type { SelectionDismissal } from '@ui/utils/selectionDismissal';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import {
  SearchableMultiSelectInline,
  type SearchableOption,
} from './searchable-multi-select';

const mouseTrail: { x: number; y: number; time: number }[] = [];
let mouseTrailUsers = 0;
const recordMouse = (event: PointerEvent) => {
  if (event.pointerType !== 'mouse') return;
  mouseTrail.push({
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
  });
  if (mouseTrail.length > 4) mouseTrail.shift();
};
function trackMouseTrail() {
  if (mouseTrailUsers++ === 0)
    window.addEventListener('pointermove', recordMouse, true);
  onCleanup(() => {
    if (--mouseTrailUsers > 0) return;
    window.removeEventListener('pointermove', recordMouse, true);
    mouseTrail.length = 0;
  });
}

/**
 * Whether the mouse's latest movement points into `content`, so a submenu
 * stays open while the mouse crosses other rows on the way to it. Unlike
 * Kobalte's grace polygon, this follows the mouse instead of expiring 300 ms
 * after it leaves the trigger.
 */
function isMouseHeadingInto(content: Element) {
  const from = mouseTrail[0];
  const to = mouseTrail.at(-1);
  if (!from || !to || performance.now() - to.time > 100) return false;
  const rect = content.getBoundingClientRect();
  const edge =
    to.x <= rect.left ? rect.left : to.x >= rect.right ? rect.right : null;
  if (edge === null) return false;
  const slack = 16;
  const top = { x: edge - from.x, y: rect.top - slack - from.y };
  const bottom = { x: edge - from.x, y: rect.bottom + slack - from.y };
  const move = { x: to.x - from.x, y: to.y - from.y };
  const cross = (a: typeof move, b: typeof move) => a.x * b.y - a.y * b.x;
  const side = Math.sign(cross(top, bottom));
  return (
    side !== 0 &&
    Math.sign(cross(top, move)) === side &&
    Math.sign(cross(move, bottom)) === side
  );
}

/** The content of another open submenu in the same menu as `trigger`. */
function openSiblingContent(trigger: HTMLElement) {
  const sibling = [
    ...(trigger
      .closest('[role="menu"]')
      ?.querySelectorAll('[aria-haspopup][aria-expanded="true"]') ?? []),
  ].find((element) => element !== trigger);
  const id = sibling?.getAttribute('aria-controls');
  return id ? document.getElementById(id) : null;
}

/**
 * Keep a submenu alive while the mouse crosses the parent menu's padding or
 * other rows on its way into the submenu.
 */
function createFilterSubmenuHover(
  options: {
    open?: Accessor<boolean>;
    onOpenChange?: (open: boolean) => void;
  } = {}
) {
  trackMouseTrail();
  const [internalOpen, setInternalOpen] = createSignal(false);
  const open = () => options.open?.() ?? internalOpen();
  let content: HTMLElement | undefined;
  let leavingWithMouse = false;
  let switchingTrigger = false;
  const headingIntoContent = () =>
    !!content?.isConnected && isMouseHeadingInto(content);
  const commitOpen = (value: boolean) => {
    setInternalOpen(value);
    options.onOpenChange?.(value);
  };
  const closeAfterGap = debounce(
    () => (headingIntoContent() ? closeAfterGap() : commitOpen(false)),
    250
  );
  // Kobalte ignores a sibling row while the mouse heads toward an open sub,
  // but only re-checks on pointermove: a mouse resting on the row would leave
  // the old sub stuck open, so switch once it has rested there.
  const openAfterRest = debounce((trigger: HTMLElement) => {
    if (open()) return;
    trigger.focus({ preventScroll: true });
    setOpen(true);
  }, 300);
  const cancelGrace = () => {
    leavingWithMouse = false;
    closeAfterGap.clear();
    openAfterRest.clear();
  };
  const setOpen = (value: boolean) => {
    if (
      !value &&
      !switchingTrigger &&
      (leavingWithMouse || headingIntoContent())
    ) {
      closeAfterGap();
      return;
    }
    cancelGrace();
    commitOpen(value);
  };

  return {
    open,
    setOpen,
    triggerProps: {
      onPointerEnter: (
        event: PointerEvent & { currentTarget: HTMLElement }
      ) => {
        cancelGrace();
        if (event.pointerType === 'mouse') openAfterRest(event.currentTarget);
      },
      onPointerMove: (event: PointerEvent & { currentTarget: HTMLElement }) => {
        if (event.pointerType !== 'mouse') return;
        const sibling = openSiblingContent(event.currentTarget);
        // Kobalte skips its hover switch for a prevented pointermove.
        if (sibling && isMouseHeadingInto(sibling)) event.preventDefault();
        openAfterRest(event.currentTarget);
      },
      onPointerLeave: (event: PointerEvent) => {
        openAfterRest.clear();
        // Kobalte's remaining pointerleave handler can focus the parent menu
        // and synchronously close this sub when outside its grace polygon.
        // Delay only those closes; later keyboard/focus changes stay immediate.
        leavingWithMouse = event.pointerType === 'mouse';
        queueMicrotask(() => {
          leavingWithMouse = false;
        });
      },
      onKeyDown: cancelGrace,
      onPointerDown: cancelGrace,
    },
    contentProps: {
      ref: (element: HTMLElement) => {
        content = element;
      },
      onPointerEnter: cancelGrace,
      onFocusOutside: (event: Event) => {
        // Padding gets a grace period; switching submenu triggers does not.
        if (
          event.target instanceof Element &&
          event.target.closest('[role="menuitem"][aria-haspopup]')
        ) {
          cancelGrace();
          switchingTrigger = true;
          queueMicrotask(() => {
            switchingTrigger = false;
          });
        }
      },
      onKeyDown: cancelGrace,
      onEscapeKeyDown: cancelGrace,
      onPointerDownOutside: cancelGrace,
    },
  };
}

export const TypeIndicator = (props: { active: boolean }) => (
  <span
    class={cn(
      'size-3.5 flex items-center justify-center shrink-0 rounded-sm border text-surface',
      props.active
        ? 'bg-accent border-accent'
        : 'border-transparent group-hover:not-hover:border-edge-muted group-data-highlighted:not-hover:border-edge-muted hover:border-accent'
    )}
  >
    <Show when={props.active}>
      <CheckIcon class="size-2.5" />
    </Show>
  </span>
);

/** The option row shared by legacy and composable app-view filters. */
export function FilterOptionItem(props: {
  label: string;
  icon?: () => JSX.Element;
  /** Drawn in place of `label`. */
  content?: () => JSX.Element;
  active: boolean;
  disabled?: boolean;
  closeOnSelect?: SelectionDismissal;
  onSelect: () => void;
}) {
  return (
    <Dropdown.Item
      role="menuitemcheckbox"
      aria-checked={props.active}
      disabled={props.disabled}
      onSelect={props.onSelect}
      closeOnSelect={props.closeOnSelect}
    >
      <TypeIndicator active={props.active} />
      <Show when={props.icon}>
        {(icon) => (
          <span class="size-4 flex items-center justify-center shrink-0">
            {icon()()}
          </span>
        )}
      </Show>
      <span
        class={cn(
          'flex-1 truncate',
          props.active ? 'text-ink' : 'text-ink-muted'
        )}
      >
        {props.content?.() ?? props.label}
      </span>
    </Dropdown.Item>
  );
}

function FilterCategoryLabel(props: { label: string; active: boolean }) {
  return (
    <>
      <span class="flex-1 text-ink">{props.label}</span>
      <Show when={props.active}>
        <span
          aria-hidden="true"
          class="size-1.5 shrink-0 rounded-full bg-accent"
        />
      </Show>
      <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
    </>
  );
}

export function FilterSubmenu<TId extends string>(props: {
  label: string;
  active?: boolean;
  options: {
    id: TId;
    label: string;
    icon?: () => JSX.Element;
    content?: () => JSX.Element;
    disabled?: boolean;
  }[];
  isSelected: (id: TId) => boolean;
  onSelect: (id: TId) => void;
  closeOnSelect?: SelectionDismissal;
  contentClass?: string;
  selectionMode?: 'single' | 'multiple';
}) {
  const submenu = createFilterSubmenuHover();
  return (
    <Dropdown.Sub open={submenu.open()} onOpenChange={submenu.setOpen}>
      <Dropdown.SubTrigger {...submenu.triggerProps}>
        <FilterCategoryLabel
          label={props.label}
          active={
            props.active ??
            props.options.some((option) => props.isSelected(option.id))
          }
        />
      </Dropdown.SubTrigger>
      <Dropdown.SubContent {...submenu.contentProps} class={props.contentClass}>
        <Dropdown.Group>
          <Show
            when={props.selectionMode === 'single'}
            fallback={
              <For each={props.options}>
                {(option) => (
                  <FilterOptionItem
                    label={option.label}
                    icon={option.icon}
                    content={option.content}
                    disabled={option.disabled}
                    active={props.isSelected(option.id)}
                    onSelect={() => props.onSelect(option.id)}
                    closeOnSelect={props.closeOnSelect}
                  />
                )}
              </For>
            }
          >
            <Dropdown.RadioGroup
              value={
                props.options.find((option) => props.isSelected(option.id))?.id
              }
              onChange={(id) => {
                const option = props.options.find((option) => option.id === id);
                if (option) props.onSelect(option.id);
              }}
            >
              <For each={props.options}>
                {(option) => (
                  <Dropdown.RadioItem
                    value={option.id}
                    disabled={option.disabled}
                    closeOnSelect={
                      props.closeOnSelect === 'unless-shift'
                        ? true
                        : props.closeOnSelect
                    }
                  >
                    <Show when={option.icon}>
                      <span class="size-4 flex items-center justify-center shrink-0">
                        {option.icon?.()}
                      </span>
                    </Show>
                    <span class="flex-1">
                      {option.content?.() ?? option.label}
                    </span>
                    <Dropdown.ItemIndicator>
                      <CheckIcon class="size-3.5 text-accent" />
                    </Dropdown.ItemIndicator>
                  </Dropdown.RadioItem>
                )}
              </For>
            </Dropdown.RadioGroup>
          </Show>
        </Dropdown.Group>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}

/** Searchable submenu for filters with many options like assignees */
export const SearchableFilterSubmenu = (props: {
  label: string;
  active?: boolean;
  options: Accessor<SearchableOption[]>;
  activeIds: Accessor<string[]>;
  onChange: (ids: string[]) => void;
  onSelectionComplete?: () => void;
  placeholder?: string;
  open?: Accessor<boolean>;
  onOpenChange?: (v: boolean) => void;
  /** Keep `options` in their given order instead of pinning selected first. */
  preserveOrder?: boolean;
}) => {
  const submenu = createFilterSubmenuHover({
    open: props.open,
    onOpenChange: props.onOpenChange,
  });
  const isOpen = submenu.open;
  const setIsOpen = submenu.setOpen;
  const [inputRef, setInputRef] = createSignal<HTMLInputElement>();

  // Focus the search input while the sub is open.
  //
  // Two issues conspire:
  //   1. Initial focus has to wait for Kobalte's DismissableLayer to register
  //      itself as a nested layer of the parent menu (done in its onMount).
  //      The sub is portaled, so focusing the input before that registration
  //      looks like "focus outside" to the parent and closes the whole menu
  //      tree. One rAF is enough to get past those onMount callbacks.
  //   2. After that, Kobalte's `onPointerMove` on the SubTrigger keeps
  //      calling `focusWithoutScrolling(e.currentTarget)` on every mouse
  //      move, stealing focus back to the trigger. Reclaim on blur — user
  //      dismissal routes (Escape / click-outside) close the sub first,
  //      which unregisters this listener before focus moves elsewhere.
  createEffect(() => {
    const el = inputRef();
    if (!isOpen() || !el) return;

    const raf = requestAnimationFrame(() => {
      if (isOpen()) el.focus();
    });

    const onBlur = () => {
      queueMicrotask(() => {
        if (isOpen() && document.activeElement !== el) el.focus();
      });
    };
    el.addEventListener('blur', onBlur);

    onCleanup(() => {
      cancelAnimationFrame(raf);
      el.removeEventListener('blur', onBlur);
    });
  });

  return (
    <Dropdown.Sub open={isOpen()} onOpenChange={setIsOpen}>
      <Dropdown.SubTrigger {...submenu.triggerProps}>
        <FilterCategoryLabel
          label={props.label}
          active={props.active ?? props.activeIds().length > 0}
        />
      </Dropdown.SubTrigger>

      <Dropdown.SubContent {...submenu.contentProps} class="w-65 max-w-[90vw]">
        <Dropdown.Group class="p-0 gap-0">
          <SearchableMultiSelectInline
            onRequestClose={() => setIsOpen(false)}
            placeholder={props.placeholder}
            activeIds={props.activeIds}
            onChange={props.onChange}
            onSelectionComplete={
              props.onSelectionComplete ?? (() => setIsOpen(false))
            }
            options={props.options}
            inputRef={setInputRef}
            preserveOrder={props.preserveOrder}
          />
        </Dropdown.Group>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
};

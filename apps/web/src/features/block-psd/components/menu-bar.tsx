/**
 * Photoshop's menu bar (File, Edit, Image, Layer, Select, Filter, View):
 * a press opens a menu, moving to another title while one is open opens
 * that one, and items may hold a submenu. Presentational.
 */

import CaretRight from '@phosphor/caret-right.svg';
import { cn } from '@ui';
import { createSignal, Index, type JSX, onCleanup, Show } from 'solid-js';

export interface MenuItem {
  label: string;
  /** Shown at the right (`⌘T`). */
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  testId?: string;
  onSelect?: () => void;
  items?: MenuEntry[];
}

export type MenuEntry = MenuItem | 'divider';

export interface MenuDefinition {
  title: string;
  testId: string;
  items: MenuEntry[];
}

/** A menu's items (items with `items` open a submenu). */
export function MenuList(props: {
  items: MenuEntry[];
  onDone: () => void;
  class?: string;
}) {
  const [submenu, setSubmenu] = createSignal<number>();
  return (
    <div
      role="menu"
      class={cn(
        'z-50 w-60 rounded-lg border border-edge-muted bg-menu p-1 text-ink text-xs shadow-lg',
        props.class
      )}
    >
      {/* By position: the entries are rebuilt as the editor changes, and
          the rows (and the focus in them) stay. */}
      <Index each={props.items}>
        {(entry, index) => (
          <Show
            when={entry() !== 'divider' && (entry() as MenuItem)}
            fallback={<div class="my-1 h-px bg-edge-muted" />}
          >
            {(item) => (
              <div
                class="relative"
                onPointerEnter={() =>
                  setSubmenu(item().items ? index : undefined)
                }
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid={item().testId}
                  disabled={item().disabled}
                  class="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
                  onClick={() => {
                    if (item().items) {
                      setSubmenu(index);
                      return;
                    }
                    item().onSelect?.();
                    props.onDone();
                  }}
                >
                  <span class="w-3 text-accent">
                    {item().checked ? '✓' : ''}
                  </span>
                  <span class="flex-1 truncate">{item().label}</span>
                  <Show when={item().shortcut}>
                    <span class="text-ink-muted">{item().shortcut}</span>
                  </Show>
                  <Show when={item().items}>
                    <CaretRight class="size-3 text-ink-muted" />
                  </Show>
                </button>
                <Show when={item().items && submenu() === index}>
                  <MenuList
                    items={item().items ?? []}
                    onDone={props.onDone}
                    class="absolute top-0 left-full ml-1"
                  />
                </Show>
              </div>
            )}
          </Show>
        )}
      </Index>
    </div>
  );
}

/**
 * Closes a menu, giving the keys to `button` when they were in the menu
 * (which goes away), so shortcuts keep working; an item that moved focus
 * elsewhere (a dialog's field) keeps it there.
 */
function closeMenu(close: () => void, button: HTMLElement | undefined) {
  const focused = document.activeElement;
  const lost =
    !focused ||
    focused === document.body ||
    focused.closest('[role="menu"]') !== null;
  close();
  if (lost) button?.focus({ preventScroll: true });
}

export function MenuBar(props: { menus: MenuDefinition[] }) {
  const [open, setOpen] = createSignal<number>();
  const titles: HTMLButtonElement[] = [];
  let root!: HTMLDivElement;
  const onDocumentDown = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) setOpen(undefined);
  };
  document.addEventListener('pointerdown', onDocumentDown);
  onCleanup(() => document.removeEventListener('pointerdown', onDocumentDown));
  return (
    <div
      ref={root}
      class="flex items-center gap-0.5"
      data-testid="psd-menu-bar"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(undefined);
      }}
    >
      {/* By position, so the titles (and the focus on them) stay while
          the menus are rebuilt. */}
      <Index each={props.menus}>
        {(menu, index) => (
          <div class="relative">
            <button
              ref={(el) => {
                titles[index] = el;
              }}
              type="button"
              data-testid={menu().testId}
              aria-expanded={open() === index}
              class="rounded-md px-2 py-1 font-medium text-xs"
              classList={{
                'bg-hover text-ink': open() === index,
                'text-ink-muted hover:text-ink': open() !== index,
              }}
              onClick={() => setOpen(open() === index ? undefined : index)}
              onPointerEnter={() => {
                if (open() !== undefined) setOpen(index);
              }}
            >
              {menu().title}
            </button>
            <Show when={open() === index}>
              <MenuList
                items={menu().items}
                onDone={() =>
                  closeMenu(() => setOpen(undefined), titles[index])
                }
                class="absolute top-full left-0 mt-1"
              />
            </Show>
          </div>
        )}
      </Index>
    </div>
  );
}

/** A menu that opens from a button (the layers panel's ⋯ and + menus). */
export function MenuButton(props: {
  label: string;
  testId?: string;
  items: MenuEntry[];
  children: JSX.Element;
  /** Opens upward (from the bottom of a panel). */
  up?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  let button!: HTMLButtonElement;
  const onDocumentDown = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener('pointerdown', onDocumentDown);
  onCleanup(() => document.removeEventListener('pointerdown', onDocumentDown));
  return (
    <div ref={root} class="relative">
      <button
        ref={button}
        type="button"
        aria-label={props.label}
        title={props.label}
        data-testid={props.testId}
        disabled={props.disabled}
        aria-expanded={open()}
        class="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-40"
        onClick={() => setOpen((o) => !o)}
      >
        {props.children}
      </button>
      <Show when={open()}>
        <MenuList
          items={props.items}
          onDone={() => closeMenu(() => setOpen(false), button)}
          class={
            props.up
              ? 'absolute bottom-full left-0 mb-1'
              : 'absolute top-full right-0 mt-1'
          }
        />
      </Show>
    </div>
  );
}

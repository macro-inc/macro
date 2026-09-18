import CheckIcon from '@phosphor/check.svg';
import {
  type Accessor,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

export type MenuHandle = {
  open: Accessor<boolean>;
  toggle: () => void;
  close: () => void;
};

/**
 * The design's anchored menu: a trigger and, while open, a panel positioned
 * off the anchor by the stylesheet (above by default, `below` for toolbars).
 * A pointer outside the anchor or Escape closes it.
 */
export function MenuAnchor(props: {
  id?: string;
  class?: string;
  style?: JSX.CSSProperties;
  menuLabel: string;
  menuClass?: string;
  role?: 'listbox' | 'menu';
  trigger: (menu: MenuHandle) => JSX.Element;
  children: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  let anchor: HTMLDivElement | undefined;
  const close = () => setOpen(false);
  const toggle = () => setOpen((current) => !current);

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!open()) return;
      if (anchor?.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open()) close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    });
  });

  return (
    <div
      ref={anchor}
      id={props.id}
      class={props.class ? `menu-anchor ${props.class}` : 'menu-anchor'}
      style={props.style}
    >
      {props.trigger({ open, toggle, close })}
      <Show when={open()}>
        <div
          class={props.menuClass ? `menu ${props.menuClass}` : 'menu'}
          role={props.role ?? 'listbox'}
          aria-label={props.menuLabel}
        >
          {props.children(close)}
        </div>
      </Show>
    </div>
  );
}

/** One row of a menu; the check mark shows on the chosen one. */
export function MenuOption(props: {
  checked?: boolean;
  disabled?: boolean;
  class?: string;
  style?: JSX.CSSProperties;
  onSelect: () => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      class={props.class ? `opt ${props.class}` : 'opt'}
      role="option"
      aria-checked={props.checked ?? false}
      aria-disabled={props.disabled || undefined}
      style={props.style}
      onClick={() => {
        if (!props.disabled) props.onSelect();
      }}
    >
      {props.children}
      <CheckIcon class="ph tick" />
    </button>
  );
}

/** A group heading inside a menu. */
export function MenuGroup(props: { children: JSX.Element }) {
  return <div class="grp">{props.children}</div>;
}

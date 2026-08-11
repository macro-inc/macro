import { isMac } from '@solid-primitives/platform';
import { type Accessor, onCleanup } from 'solid-js';

export type CtrlJKMenuNavigationOptions = {
  enabled?: boolean;
  macOnly?: boolean;
  /**
   * When `true`, vertical navigation wraps around the ends of the list:
   * pressing down on the last item jumps to the first, and up on the first
   * jumps to the last.
   *
   * Kobalte's Select/menu components don't expose a focus-wrap prop, so this
   * is implemented by dispatching `Home`/`End` (which Kobalte does handle)
   * when the highlighted item is already at an edge. Defaults to `false` to
   * preserve existing (clamping) behavior.
   */
  wrap?: boolean;
};

/**
 * Elements Kobalte marks as navigable in its listbox/menu collections. The
 * highlighted one carries `data-highlighted`; disabled ones carry
 * `data-disabled`.
 */
const NAVIGABLE_ITEM_SELECTOR =
  '[role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

export function highlightFirstMenuItemOnOpen(el: HTMLElement) {
  setTimeout(() => {
    requestAnimationFrame(() => {
      if (!el.isConnected || el.querySelector('[data-highlighted]')) return;

      const activeElement = document.activeElement;
      if (activeElement && activeElement !== el && el.contains(activeElement)) {
        return;
      }

      if (!el.querySelector(NAVIGABLE_ITEM_SELECTOR)) return;

      el.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          code: 'ArrowDown',
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );
    });
  }, 0);
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      ctrlJKMenuNavigation: CtrlJKMenuNavigationOptions | boolean | undefined;
    }
  }
}

function resolveOptions(
  options: CtrlJKMenuNavigationOptions | boolean | undefined
): Required<CtrlJKMenuNavigationOptions> {
  if (typeof options === 'boolean') {
    return { enabled: options, macOnly: true, wrap: false };
  }

  return {
    enabled: options?.enabled ?? true,
    macOnly: options?.macOnly ?? true,
    wrap: options?.wrap ?? false,
  };
}

/**
 * Wraps an index within `[0, length)`, cycling around the ends.
 *
 * Moving past the last item lands on the first, and moving before the first
 * lands on the last. Useful for manual (non-Kobalte) list navigation that
 * would otherwise clamp with `Math.min`/`Math.max`.
 *
 * Starting from `-1` (nothing focused) with a positive `delta` selects the
 * first item; with a negative `delta` it selects the last.
 *
 * @param index - The current index (may be `-1` for "no selection").
 * @param length - The number of items in the list.
 * @param delta - How far to move (e.g. `1` for down, `-1` for up).
 * @returns The wrapped index, or `-1` when the list is empty.
 */
export function wrapIndex(index: number, length: number, delta: number) {
  if (length <= 0) return -1;
  return (((index + delta) % length) + length) % length;
}

function translatedArrowKey(e: KeyboardEvent, macOnly: boolean) {
  if (macOnly && !isMac) return;
  if (!e.ctrlKey || e.metaKey || e.altKey) return;

  switch (e.key.toLowerCase()) {
    case 'j':
      return 'ArrowDown';
    case 'k':
      return 'ArrowUp';
    case 'h':
      return 'ArrowLeft';
    case 'l':
      return 'ArrowRight';
  }
}

/**
 * When wrapping is enabled and the highlighted item sits at an edge, returns
 * the key that jumps to the opposite end (`Home`/`End`) instead of the arrow
 * key that would otherwise do nothing. Returns the original `key` when no
 * wrap is needed or the list state can't be determined.
 */
function wrappedEdgeKey(e: KeyboardEvent, key: 'ArrowDown' | 'ArrowUp') {
  const root =
    (e.currentTarget instanceof Element ? e.currentTarget : null) ??
    (e.target instanceof Element
      ? e.target.closest('[role="listbox"], [role="menu"]')
      : null);
  if (!root) return key;

  const items = Array.from(
    root.querySelectorAll<HTMLElement>(NAVIGABLE_ITEM_SELECTOR)
  ).filter(
    (el) =>
      !el.hasAttribute('data-disabled') &&
      el.getAttribute('aria-disabled') !== 'true'
  );
  if (items.length === 0) return key;

  const currentIndex = items.findIndex((el) =>
    el.hasAttribute('data-highlighted')
  );

  if (key === 'ArrowDown' && currentIndex === items.length - 1) return 'Home';
  if (key === 'ArrowUp' && currentIndex === 0) return 'End';
  return key;
}

export function handleCtrlJKMenuNavigation(
  e: KeyboardEvent,
  options?: CtrlJKMenuNavigationOptions | boolean
) {
  const resolved = resolveOptions(options);
  if (!resolved.enabled) return false;

  const key = translatedArrowKey(e, resolved.macOnly);
  if (!key) return false;

  e.preventDefault();
  e.stopPropagation();

  const target = e.target instanceof Element ? e.target : e.currentTarget;
  if (!(target instanceof Element)) return true;

  const dispatchedKey =
    resolved.wrap && (key === 'ArrowDown' || key === 'ArrowUp')
      ? wrappedEdgeKey(e, key)
      : key;

  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: dispatchedKey,
      code: dispatchedKey,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );

  return true;
}

export function addCtrlJKMenuNavigation(
  el: HTMLElement,
  options?: Accessor<CtrlJKMenuNavigationOptions | boolean | undefined>
) {
  const handleKeyDown = (e: KeyboardEvent) => {
    handleCtrlJKMenuNavigation(e, options?.());
  };

  el.addEventListener('keydown', handleKeyDown, { capture: true });

  return () => {
    el.removeEventListener('keydown', handleKeyDown, { capture: true });
  };
}

export function ctrlJKMenuNavigation(
  el: HTMLElement,
  options: Accessor<CtrlJKMenuNavigationOptions | boolean | undefined>
) {
  const cleanup = addCtrlJKMenuNavigation(el, options);
  onCleanup(cleanup);
}

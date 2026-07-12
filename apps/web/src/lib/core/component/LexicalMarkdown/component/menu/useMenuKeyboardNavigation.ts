import { onCleanup, onMount } from 'solid-js';

type MenuKeyboardHandlers = {
  /** Called when the user navigates up (ArrowUp, Ctrl+K, Ctrl+P, Shift+Tab) */
  onUp?: (e: KeyboardEvent) => void;

  /** Called when the user navigates down (ArrowDown, Ctrl+J, Ctrl+N, Tab) */
  onDown?: (e: KeyboardEvent) => void;

  /** Called when the user navigates left (ArrowLeft, Ctrl+H) */
  onLeft?: (e: KeyboardEvent) => void;

  /** Called when the user navigates right (ArrowRight, Ctrl+L) */
  onRight?: (e: KeyboardEvent) => void;

  /** Called when the user confirms selection (Enter) */
  onSelect?: (e: KeyboardEvent) => void;

  /** Called when the user cancels/closes (Escape) */
  onClose?: (e: KeyboardEvent) => void;

  /**
   * Called when the user presses Space.
   * Return `true` to preventDefault/stopPropagation, `false` to let it through.
   */
  onSpace?: (e: KeyboardEvent) => boolean;

  /** Called for any key that doesn't match a navigation handler. */
  onOtherKey?: (e: KeyboardEvent) => void;

  /**
   * Guard function - if returns false, no handlers are called.
   */
  isActive?: () => boolean;

  /**
   * Whether to use capture phase for the event listener.
   * @default true
   */
  capture?: boolean;

  /**
   * Whether to automatically call e.preventDefault() and e.stopPropagation()
   * when a handler is matched.
   * @default true
   */
  preventDefault?: boolean;
};

/**
 * Creates a keyboard handler that maps various key combinations to
 * directional navigation callbacks.
 *
 * Key mappings:
 * - Up: ArrowUp, Ctrl+K, Ctrl+P, Shift+Tab
 * - Down: ArrowDown, Ctrl+J, Ctrl+N, Tab (without Shift)
 * - Left: ArrowLeft, Ctrl+H
 * - Right: ArrowRight, Ctrl+L
 * - Select: Enter
 * - Close: Escape
 * - Space: Space
 *
 * @example
 * ```ts
 * const { handleKeyDown } = createMenuKeyboardNavigation({
 *   isActive: () => menuOpen(),
 *   onUp: () => setSelectedIndex(i => Math.max(0, i - 1)),
 *   onDown: () => setSelectedIndex(i => Math.min(items.length - 1, i + 1)),
 *   onSelect: () => selectCurrentItem(),
 *   onClose: () => setMenuOpen(false),
 *   onSpace: () => handleEscapeSpace(),
 *   onOtherKey: () => resetEscapeSpaceState(),
 * });
 * ```
 */
function createMenuKeyboardNavigation(handlers: MenuKeyboardHandlers): {
  handleKeyDown: (e: KeyboardEvent) => void;
} {
  const {
    onUp,
    onDown,
    onLeft,
    onRight,
    onSelect,
    onClose,
    onSpace,
    onOtherKey,
    isActive,
    preventDefault = true,
  } = handlers;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isActive && !isActive()) return;

    let handler: ((e: KeyboardEvent) => void) | undefined;

    switch (e.key) {
      case 'ArrowUp':
        handler = onUp;
        break;

      case 'ArrowDown':
        handler = onDown;
        break;

      case 'ArrowLeft':
        handler = onLeft;
        break;

      case 'ArrowRight':
        handler = onRight;
        break;

      case 'Tab':
        handler = e.shiftKey ? onUp : onDown;
        break;

      case 'j':
        if (e.ctrlKey || e.metaKey) {
          handler = onDown;
        }
        break;

      case 'k':
        if (e.ctrlKey || e.metaKey) {
          handler = onUp;
        }
        break;

      case 'h':
        if (e.ctrlKey || e.metaKey) {
          handler = onLeft;
        }
        break;

      case 'l':
        if (e.ctrlKey || e.metaKey) {
          handler = onRight;
        }
        break;

      case 'n':
        if (e.ctrlKey) {
          handler = onDown;
        }
        break;

      case 'p':
        if (e.ctrlKey) {
          handler = onUp;
        }
        break;

      case 'Enter':
        handler = onSelect;
        break;

      case 'Escape':
        handler = onClose;
        break;

      case ' ':
        if (onSpace) {
          const shouldPrevent = onSpace(e);
          if (shouldPrevent) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
        return;
    }

    if (handler) {
      if (preventDefault) {
        e.preventDefault();
        e.stopPropagation();
      }
      handler(e);
    } else {
      onOtherKey?.(e);
    }
  };

  return { handleKeyDown };
}

export function useMenuKeyboardNavigation(handlers: MenuKeyboardHandlers): {
  handleKeyDown: (e: KeyboardEvent) => void;
} {
  const { handleKeyDown } = createMenuKeyboardNavigation(handlers);
  const capture = handlers.capture ?? true;

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown, { capture });
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown, { capture });
    });
  });

  return { handleKeyDown };
}

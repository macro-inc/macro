import { onCleanup } from 'solid-js';
import { focusAdjacent } from './cell-focus';

type Direction = 1 | -1;

/** True while an IME is composing, when keys belong to the composition. */
export function isComposingKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/**
 * The keyboard contract of a cell that edits through a popup: Enter, Space and
 * F2 open it, Tab on the trigger moves to the adjacent cell, and leaving the
 * open popup with Tab moves on once the popup has given focus back.
 */
export function createPopupCellKeys(options: {
  readonly onNavigate?: (direction: Direction) => boolean;
  edit: (event: KeyboardEvent) => void;
  close: () => void;
}) {
  let trigger: HTMLElement | undefined;
  let leaving: Direction | undefined;
  function moveToCell(direction: Direction) {
    if (!options.onNavigate?.(direction)) focusAdjacent(trigger, direction);
  }
  function openWithKeyboard(event: KeyboardEvent) {
    if (
      isComposingKey(event) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !['Enter', ' ', 'F2'].includes(event.key)
    )
      return;
    // Opened through state to skip Kobalte's trigger scroll helper.
    event.preventDefault();
    event.stopImmediatePropagation();
    options.edit(event);
  }
  return {
    triggerRef(element: HTMLElement) {
      trigger = element;
      element.addEventListener('keydown', openWithKeyboard, true);
      onCleanup(() =>
        element.removeEventListener('keydown', openWithKeyboard, true)
      );
    },
    focus: () => trigger?.focus(),
    /** Tab on the closed trigger; false when the grid does not navigate. */
    tabFromTrigger(event: KeyboardEvent): boolean {
      if (event.key !== 'Tab' || !options.onNavigate) return false;
      event.preventDefault();
      event.stopPropagation();
      moveToCell(event.shiftKey ? -1 : 1);
      return true;
    },
    leave(direction: Direction) {
      leaving = direction;
      options.close();
    },
    onCloseAutoFocus(event: Event) {
      if (!leaving) return;
      event.preventDefault();
      const direction = leaving;
      leaving = undefined;
      // Wait until the popup restores its trigger before mounting the next
      // cell's editor.
      queueMicrotask(() => moveToCell(direction));
    },
  };
}

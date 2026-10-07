import { createFocusManager } from '@kobalte/utils';

/** Leave a cell at the table boundary, preserving a surrounding dialog's focus loop. */
export function focusAdjacent(
  trigger: HTMLElement | undefined,
  direction: 1 | -1
) {
  if (!trigger?.isConnected) return false;
  const dialog = trigger.closest<HTMLElement>('[role="dialog"]');
  const manager = createFocusManager(
    () => dialog ?? trigger.ownerDocument.body
  );
  const options = { from: trigger, tabbable: true, wrap: Boolean(dialog) };
  return Boolean(
    direction === 1
      ? manager.focusNext(options)
      : manager.focusPrevious(options)
  );
}

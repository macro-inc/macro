import { globalTabManager } from '@app/signal/tabLayout';
import { armOpenInNewTabIntent } from './open-in-tab-intent';

/** Whether menus offer "Open in new tab": desktop tabs are on. */
export function canOpenInNewTab(): boolean {
  return globalTabManager() !== undefined;
}

/**
 * "Open in new tab" from a menu: runs the item's ordinary open in the current
 * split, which `openInNewTabMiddleware` turns into a new tab as it does for
 * Cmd+click, so each surface keeps its own open path. Switches to the tab,
 * like "Open in new split" focuses the new split.
 */
export function openInNewTab<T>(open: () => T): T | undefined {
  if (!canOpenInNewTab()) return;
  armOpenInNewTabIntent({ activate: true });
  return open();
}

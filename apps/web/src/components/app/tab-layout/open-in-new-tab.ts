import { globalTabManager } from '@app/signal/tabLayout';
import { fireAndForget } from '@core/util/fireAndForget';
import { holdOpenInNewTabIntent } from './open-in-tab-intent';

/** Whether menus offer "Open in new tab": desktop tabs are on. */
export function canOpenInNewTab(): boolean {
  return globalTabManager() !== undefined;
}

/**
 * "Open in new tab" from a menu: runs the item's ordinary current-split open
 * with the open-in-new-tab intent armed, as Cmd+click arms it, so each surface
 * keeps its own open path. The split manager (or, for opens that bypass it,
 * `openInNewTabMiddleware`) turns that open into a new tab, and switches to
 * it like "Open in new split" focuses the new split.
 */
export function openInNewTab<T>(open: () => T): T | undefined {
  if (!canOpenInNewTab()) return;
  const release = holdOpenInNewTabIntent({ activate: true });
  let result: T;
  try {
    result = open();
  } catch (error) {
    release();
    throw error;
  }
  if (result instanceof Promise) {
    fireAndForget(settle(result, release), 'desktop-tabs');
  } else {
    release();
  }
  return result;
}

async function settle(pending: Promise<unknown>, release: () => void) {
  try {
    await pending;
  } finally {
    release();
  }
}

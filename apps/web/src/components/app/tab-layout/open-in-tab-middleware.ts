import type { SplitRouterMiddleware } from '@app/lib/split-router';
import { globalTabManager } from '@app/signal/tabLayout';
import { consumeOpenInNewTabIntent } from './open-in-tab-intent';

/**
 * Cmd+click (ctrl elsewhere) opens the destination in a new desktop tab
 * instead of navigating. Runs for every pane navigation, so it covers
 * mentions, lists, buttons, and links without touching their handlers; it
 * does nothing when tabs are off or the last click carried no modifier.
 */
export const openInNewTabMiddleware: SplitRouterMiddleware = (context) => {
  if (context.cause !== 'navigate') return;

  const tabManager = globalTabManager();
  if (!tabManager) return;

  const intent = consumeOpenInNewTabIntent();
  if (!intent) return;

  tabManager.openEntryInNewTab(context.to, intent);

  return context.cancel();
};

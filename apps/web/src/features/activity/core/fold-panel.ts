import type { FeedEntry } from './collapse-runs';

/**
 * The side panel's collapsed shape: the newest `head` entries, how many are
 * folded away behind the toggle, and the oldest fetched entry pinned last
 * so the line that started the entity's history stays in view.
 */
export type PanelFold = {
  head: FeedEntry[];
  hidden: number;
  tail: FeedEntry | undefined;
};

/**
 * Fold `entries` (newest first) to `limit` visible lines plus a pinned tail.
 * Nothing folds when every entry already fits, tail included.
 */
export function foldPanel(entries: FeedEntry[], limit: number): PanelFold {
  if (entries.length <= limit + 1) {
    return { head: entries, hidden: 0, tail: undefined };
  }
  return {
    head: entries.slice(0, limit),
    hidden: entries.length - limit - 1,
    tail: entries[entries.length - 1],
  };
}

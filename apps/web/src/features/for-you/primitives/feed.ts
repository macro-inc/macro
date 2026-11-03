import { createMemo, createSignal } from 'solid-js';
import type {
  FeedActions,
  FeedPreferences,
  FeedSource,
} from '../context/feed-source';
import { type FeedFilter, type FeedItem, interleaveFeed } from '../core/feed';

/** Feed state over live recommendations; dismissals persist without changing source entities. */
export function createFeedItems(
  source: FeedSource,
  preferences: FeedPreferences
) {
  const [filter, setFilter] = createSignal<FeedFilter>('all');
  const [dismissed, setDismissed] = createSignal<string[]>([]);
  const visible = createMemo(() => {
    const selected = filter();
    const items = (source.items() ?? []).filter((item) => {
      if (preferences.hiddenIds().includes(item.id)) return false;
      if (selected === 'save_money' || selected === 'make_money') {
        return item.kind === 'idea' && item.moneyCategories.includes(selected);
      }
      return selected === 'all' || selected === item.kind;
    });
    return selected === 'all' ? interleaveFeed(items) : items;
  });
  return {
    filter,
    setFilter,
    visible,
    dismiss: (id: string) => {
      preferences.setHiddenIds([...preferences.hiddenIds(), id]);
      setDismissed((current) => [...current, id]);
    },
    undo: () => {
      const id = dismissed().at(-1);
      if (!id) return;
      preferences.setHiddenIds(
        preferences.hiddenIds().filter((value) => value !== id)
      );
      setDismissed((current) => current.slice(0, -1));
      return id;
    },
    canUndo: () => dismissed().length > 0,
  };
}

export function createFeed(
  source: FeedSource,
  preferences: FeedPreferences,
  actions: FeedActions
) {
  const items = createFeedItems(source, preferences);
  const [openingId, setOpeningId] = createSignal<string>();
  const [actionError, setActionError] = createSignal(false);
  const start = async (item: FeedItem) => {
    if (openingId()) return;
    setOpeningId(item.id);
    setActionError(false);
    try {
      await actions.start(item);
    } catch {
      setActionError(true);
    } finally {
      setOpeningId(undefined);
    }
  };
  return {
    ...items,
    openingId,
    actionError,
    start,
    openSource: actions.openSource,
  };
}

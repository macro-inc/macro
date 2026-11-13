import { type Accessor, createSignal } from 'solid-js';
import {
  activeFilterCount,
  DEFAULT_INBOX_FILTERS,
  type InboxCategory,
  type InboxFilters,
  type InboxLane,
  type InboxStatus,
  parseInboxFilters,
  rowTypesFor,
  serializeInboxFilters,
} from '../core/inbox-filters';

/** Where the lane is kept, such as the view's URL. */
export type InboxLaneLocation = {
  lane: Accessor<InboxLane>;
  setLane: (lane: InboxLane) => void;
};

/** A lane kept for as long as its owner lives, starting in Signal. */
export function createInboxLane(): InboxLaneLocation {
  const [lane, setLane] = createSignal<InboxLane>('signal');
  return { lane, setLane };
}

/**
 * The reader's inbox filters. The read state and hidden kinds are kept in
 * `storage` between visits; the lane lives in `lane`, never in storage.
 */
export function createInboxFilters(
  storage: {
    read: () => string | null;
    write: (value: string) => void;
  },
  lane: InboxLaneLocation = createInboxLane()
) {
  const [saved, setSaved] = createSignal(parseInboxFilters(storage.read()));
  const filters = (): InboxFilters => ({ ...saved(), lane: lane.lane() });
  const save = (next: InboxFilters) => {
    setSaved(next);
    storage.write(serializeInboxFilters(next));
  };

  return {
    filters,
    rowTypes: () => rowTypesFor(filters()),
    activeCount: () => activeFilterCount(filters()),
    isShown: (category: InboxCategory) =>
      !filters().hiddenCategories.includes(category),
    /** Every category is hidden, so nothing can show. */
    showsNothing: () => rowTypesFor(filters()).length === 0,
    /**
     * The rows the feed reads: this lane, these kinds, and only unread ones
     * under Unread.
     */
    scope: () => ({
      lane: filters().lane,
      rowTypes: rowTypesFor(filters()),
      unreadOnly: filters().status === 'unread',
    }),
    setLane: lane.setLane,
    setStatus: (status: InboxStatus) => save({ ...filters(), status }),
    setShown: (category: InboxCategory, shown: boolean) => {
      const hidden = filters().hiddenCategories.filter(
        (hiddenCategory) => hiddenCategory !== category
      );
      save({
        ...filters(),
        hiddenCategories: shown ? hidden : [...hidden, category],
      });
    },
    /** Show every kind again; the All and Unread choice stays. */
    reset: () =>
      save({
        ...filters(),
        hiddenCategories: DEFAULT_INBOX_FILTERS.hiddenCategories,
      }),
  };
}

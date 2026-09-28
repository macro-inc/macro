import { batch, createSignal } from 'solid-js';

export type History<T extends object> = {
  readonly items: ReadonlyArray<T>;
  readonly index: Readonly<number>;
  back: () => T | null;
  /**
   * Jump to the nearest earlier entry matching `predicate`, skipping the
   * entries in between. Navigation also respects the configured `canVisit`
   * rule. Skipped entries stay in the stack and can be reached when available.
   * Returns null — leaving the index put — when no available entry matches.
   */
  backTo: (predicate: (item: T) => boolean) => T | null;
  forward: () => T | null;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  push: (next: T) => void;
  merge: (next: T) => void;
  /**
   * Replace the item at the current index in-place without changing the index
   * or truncating forward entries. Used to update an entry's mutable state
   * (e.g. captured per-entry state) before navigating away.
   */
  replaceCurrent: (next: T) => void;
  remove: (predicate: (item: T) => boolean) => T | null;
};

const inc = (x: number) => x + 1;

export function createHistory<T extends object>(
  options: {
    /** Evaluated on each navigation so entry availability can change over time. */
    canVisit?: (item: T) => boolean;
  } = {}
): History<T> {
  const canVisit = options.canVisit ?? (() => true);
  // `items` is a signal rather than a plain mutated array because SplitState.history
  // is held in the splits store. In-place array mutation is invisible to store
  // readers, which would leave `items` stale while the `index` signal stays live —
  // their lengths desync and bounds checks (e.g. entry-state capture) misfire.
  const [items, setItems] = createSignal<T[]>([]);
  const [index, setIndex] = createSignal(-1);

  const findIndex = (direction: -1 | 1, predicate = (_item: T) => true) => {
    const list = items();
    for (
      let i = index() + direction;
      i >= 0 && i < list.length;
      i += direction
    ) {
      if (canVisit(list[i]) && predicate(list[i])) return i;
    }
    return -1;
  };

  const canGoBack = () => findIndex(-1) !== -1;
  const canGoForward = () => findIndex(1) !== -1;

  const isAtEnd = () => {
    const len = items().length;
    if (len === 0) return true;
    return index() === len - 1;
  };

  const push = (next: T) => {
    if (!isAtEnd()) {
      fork(next);
      return;
    }
    batch(() => {
      setItems((prev) => [...prev, next]);
      setIndex(inc);
    });
  };

  const merge = (next: T) => {
    // Keep back entries, drop the current + forward, and land on `next`. Set the
    // index explicitly so merging from a non-end (or empty) entry can't strand it
    // past the truncated array.
    batch(() => {
      const keep = Math.max(index(), 0);
      setItems((prev) => [...prev.slice(0, keep), next]);
      setIndex(keep);
    });
  };

  const replaceCurrent = (next: T) => {
    const i = index();
    if (i < 0 || i >= items().length) return;
    setItems((prev) => {
      const copy = prev.slice();
      copy[i] = next;
      return copy;
    });
  };

  const fork = (next: T) => {
    batch(() => {
      setItems((prev) => [...prev.slice(0, index() + 1), next]);
      setIndex(inc);
    });
  };

  const move = (direction: -1 | 1, predicate?: (item: T) => boolean) => {
    const nextIndex = findIndex(direction, predicate);
    if (nextIndex === -1) return null;
    setIndex(nextIndex);
    return items()[nextIndex];
  };

  const back = () => move(-1);
  const backTo = (predicate: (item: T) => boolean) => move(-1, predicate);
  const forward = () => move(1);

  const remove = (predicate: (item: T) => boolean) => {
    const prevItems = items();
    const prevIndex = index();

    let newIndex = prevIndex;
    const nextItems: T[] = [];

    for (let i = 0; i < prevItems.length; i++) {
      const item = prevItems[i];
      if (predicate(item)) {
        if (i < prevIndex) {
          newIndex -= 1;
        }
        continue;
      }
      nextItems.push(item);
    }

    if (nextItems.length === 0) {
      batch(() => {
        setItems([]);
        setIndex(-1);
      });
      return null;
    }

    if (newIndex >= nextItems.length) {
      newIndex = nextItems.length - 1;
    }

    const next = nextItems[newIndex];
    if (next && !canVisit(next)) return null;
    batch(() => {
      setItems(nextItems);
      setIndex(newIndex);
    });
    return nextItems[newIndex] ?? null;
  };
  return {
    get items() {
      return items();
    },
    get index() {
      return index();
    },
    back,
    backTo,
    push,
    merge,
    replaceCurrent,
    forward,
    canGoBack,
    canGoForward,
    remove,
  };
}

import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { ListKey } from './types';

export type CreateSelectionStateOptions<TItem> = {
  items: Accessor<readonly TItem[]>;
  getKey: (item: TItem) => ListKey;
  initialKeys?: Iterable<ListKey>;
  onChange?: (keys: ReadonlySet<ListKey>) => void;
};

/** ID-only selection state. Item payloads are always derived from current data. */
export type SelectionState<TItem> = {
  keys: Accessor<ReadonlySet<ListKey>>;
  items: Accessor<readonly TItem[]>;
  missingKeys: Accessor<ReadonlySet<ListKey>>;
  count: Accessor<number>;
  isSelected: (key: ListKey) => boolean;
  select: (key: ListKey) => void;
  deselect: (key: ListKey) => void;
  toggle: (key: ListKey) => void;
  add: (keys: Iterable<ListKey>) => void;
  replace: (keys: Iterable<ListKey>) => void;
  clear: () => void;
  /** Explicitly remove keys that are not present in the current collection. */
  prune: () => void;
};

/**
 * Creates selection state without retaining item objects.
 *
 * Missing keys intentionally survive collection replacement until `prune` is
 * called. This lets a view preserve selection while data is temporarily absent
 * during refetching without an effect synchronizing two sources of truth.
 */
export function createSelectionState<TItem>(
  options: CreateSelectionStateOptions<TItem>
): SelectionState<TItem> {
  const selected = new Set<ListKey>(options.initialKeys ?? []);
  const [version, invalidate] = createSignal(undefined, { equals: false });

  const keys = createMemo<ReadonlySet<ListKey>>(() => {
    version();
    return new Set(selected);
  });

  const currentItems = createMemo(() => {
    version();
    return options.items().filter((item) => selected.has(options.getKey(item)));
  });

  const missingKeys = createMemo<ReadonlySet<ListKey>>(() => {
    version();
    const available = new Set(options.items().map(options.getKey));
    return new Set([...selected].filter((key) => !available.has(key)));
  });

  const notify = () => {
    invalidate();
    options.onChange?.(new Set(selected));
  };

  const select = (key: ListKey) => {
    if (selected.has(key)) return;
    selected.add(key);
    notify();
  };

  const deselect = (key: ListKey) => {
    if (!selected.delete(key)) return;
    notify();
  };

  const add = (nextKeys: Iterable<ListKey>) => {
    let changed = false;
    for (const key of nextKeys) {
      if (selected.has(key)) continue;
      selected.add(key);
      changed = true;
    }
    if (changed) notify();
  };

  const replace = (nextKeys: Iterable<ListKey>) => {
    const next = new Set(nextKeys);
    if (
      next.size === selected.size &&
      [...next].every((key) => selected.has(key))
    ) {
      return;
    }

    selected.clear();
    for (const key of next) selected.add(key);
    notify();
  };

  const clear = () => {
    if (selected.size === 0) return;
    selected.clear();
    notify();
  };

  const prune = () => {
    const available = new Set(options.items().map(options.getKey));
    let changed = false;
    for (const key of selected) {
      if (available.has(key)) continue;
      selected.delete(key);
      changed = true;
    }
    if (changed) notify();
  };

  return {
    keys,
    items: currentItems,
    missingKeys,
    count: () => keys().size,
    isSelected: (key) => keys().has(key),
    select,
    deselect,
    toggle: (key) => (selected.has(key) ? deselect(key) : select(key)),
    add,
    replace,
    clear,
    prune,
  };
}

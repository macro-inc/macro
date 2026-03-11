import { createSignal, createMemo, type Accessor } from 'solid-js';

export type CreateSelectionOptions<T> = {
  /** Function to extract ID from item */
  getItemId: (item: T) => string;
  /** Initial selected items */
  initial?: T[];
  onChange?: (selected: T[]) => void;
};

export type SelectionState<T> = {
  readonly selected: Accessor<T[]>;
  readonly selectedIds: Accessor<Set<string>>;
  /** Number of selected items */
  readonly count: Accessor<number>;
  readonly isSelected: (id: string) => boolean;
  readonly get: (id: string) => T | undefined;
  readonly toggle: (item: T) => void;
  readonly select: (item: T) => void;
  readonly deselect: (id: string) => void;
  readonly selectRange: (items: T[]) => void;
  readonly set: (items: T[]) => void;
  readonly clear: () => void;
};

/**
 * Creates reactive selection state.
 *
 * @example
 * ```ts
 * const selection = createSelectionState({
 *   getItemId: (item) => item.id,
 *   onChange: (selected) => console.log('Selected:', selected.length),
 * });
 *
 * selection.select(item1);
 * selection.toggle(item2);
 * selection.isSelected(item1.id); // true
 * selection.selected(); // [item1, item2]
 * ```
 */
export function createSelectionState<T>(
  options: CreateSelectionOptions<T>
): SelectionState<T> {
  const { getItemId, initial = [], onChange } = options;

  // Mutable map + version signal for efficient O(1) mutations
  const items = new Map<string, T>(
    initial.map((item) => [getItemId(item), item])
  );
  const [version, setVersion] = createSignal(0);

  const touch = () => setVersion((v) => v + 1);
  const notify = () => onChange?.(Array.from(items.values()));

  // Derived state reads version to subscribe to mutations
  const selected = createMemo(() => {
    version();
    return Array.from(items.values());
  });

  const selectedIds = createMemo(() => {
    version();
    return new Set(items.keys());
  });

  const count = createMemo(() => {
    version();
    return items.size;
  });

  const isSelected = (id: string): boolean => {
    version();
    return items.has(id);
  };

  const get = (id: string): T | undefined => {
    version();
    return items.get(id);
  };

  const select = (item: T) => {
    const id = getItemId(item);
    if (items.has(id)) return;
    items.set(id, item);
    touch();
    notify();
  };

  const deselect = (id: string) => {
    if (!items.has(id)) return;
    items.delete(id);
    touch();
    notify();
  };

  const toggle = (item: T) => {
    const id = getItemId(item);
    if (items.has(id)) {
      deselect(id);
    } else {
      select(item);
    }
  };

  const selectRange = (newItems: T[]) => {
    let changed = false;
    for (const item of newItems) {
      const id = getItemId(item);
      if (!items.has(id)) {
        items.set(id, item);
        changed = true;
      }
    }
    if (changed) {
      touch();
      notify();
    }
  };

  const set = (newItems: T[]) => {
    items.clear();
    for (const item of newItems) {
      items.set(getItemId(item), item);
    }
    touch();
    notify();
  };

  const clear = () => {
    if (items.size === 0) return;
    items.clear();
    touch();
    notify();
  };

  return {
    selected,
    selectedIds,
    count,
    isSelected,
    get,
    toggle,
    select,
    deselect,
    selectRange,
    set,
    clear,
  };
}

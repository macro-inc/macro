import { type Accessor, createSignal } from 'solid-js';

export type SortConfig<T, TId extends string = string> = {
  id: TId;
  fn: (a: T, b: T) => number;
  desc?: boolean;
};

/** Sort state return type with strongly typed IDs */
export type SortState<T, TId extends string = string> = {
  /** Currently active sort configs (ordered by priority) */
  active: Accessor<SortConfig<T, TId>[]>;
  isActive: (id: TId) => boolean;
  /** Toggle a sort on/off */
  toggle: (id: TId, value?: boolean) => void;
  /** Set multiple sorts by IDs (in priority order) */
  setAll: (ids: TId[]) => void;
  clear: () => void;
  /** True when the given sort id is currently flipped from its natural direction. */
  isReversed: (id: TId) => boolean;
  /** Flip the direction of the given sort id (no-op if not active). */
  toggleDirection: (id: TId) => void;
  /** Available sort configs */
  available: Record<TId, SortConfig<T>>;
};

export const createSortState = <
  T,
  TConfigs extends Record<string, SortConfig<T>>,
>(
  configs: TConfigs,
  initialSortIds?: (keyof TConfigs & string)[]
): SortState<T, keyof TConfigs & string> => {
  type TId = keyof TConfigs & string;

  const initialSorts = (initialSortIds ?? [])
    .map((id) => configs[id])
    .filter((c) => c !== undefined);

  const [activeSorts, setActiveSorts] =
    createSignal<SortConfig<T>[]>(initialSorts);
  const [reversedIds, setReversedIds] = createSignal<Set<string>>(new Set());

  const isActive = (id: TId): boolean =>
    activeSorts().some((s) => s.id === configs[id]?.id);

  const isReversed = (id: TId): boolean => reversedIds().has(id);

  const pruneReversed = (keep: Set<string>) => {
    setReversedIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) if (keep.has(id)) next.add(id);
      return next;
    });
  };

  const add = (id: TId) => {
    const config = configs[id];
    if (!config || isActive(id)) return;
    setActiveSorts((prev) => [...prev, config]);
  };

  const remove = (id: TId) => {
    const config = configs[id];
    if (!config || !isActive(id)) return;
    setActiveSorts((prev) => prev.filter((s) => s.id !== config.id));
    setReversedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggle = (id: TId, value?: boolean) => {
    if (value === true) {
      add(id);
    } else if (value === false) {
      remove(id);
    } else if (isActive(id)) {
      remove(id);
    } else {
      add(id);
    }
  };

  const setAll = (ids: TId[]) => {
    const newSorts = ids
      .map((id) => configs[id])
      .filter((c) => c !== undefined);
    setActiveSorts(newSorts);
    pruneReversed(new Set(newSorts.map((s) => s.id)));
  };

  const clear = () => {
    setActiveSorts([]);
    setReversedIds(new Set<string>());
  };

  const toggleDirection = (id: TId) => {
    if (!isActive(id)) return;
    setReversedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return {
    active: activeSorts,
    isActive,
    toggle,
    setAll,
    clear,
    isReversed,
    toggleDirection,
    available: configs as Record<TId, SortConfig<T>>,
  };
};

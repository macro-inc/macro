import { type Accessor, createSignal } from 'solid-js';

export type SortConfig<T, TId extends string = string> = {
  id: TId;
  fn: (a: T, b: T) => number;
  desc?: boolean;
  /** True when the comparator output is negated relative to its natural order. */
  reversed?: boolean;
};

/** Sort state return type with strongly typed IDs */
export type SortState<T, TId extends string = string> = {
  /** Currently active sort configs (ordered by priority) */
  active: Accessor<SortConfig<T, TId>[]>;
  isActive: (id: TId) => boolean;
  /** Toggle a sort on/off */
  toggle: (id: TId, value?: boolean) => void;
  /** Set multiple sorts by IDs (in priority order); resets reversed state */
  setAll: (ids: TId[]) => void;
  /** Negate the comparator for an active sort. No-op if not active. */
  flip: (id: TId) => void;
  clear: () => void;
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
  type Entry = { id: TId; reversed: boolean };

  const initialEntries: Entry[] = (initialSortIds ?? [])
    .filter((id) => configs[id] !== undefined)
    .map((id) => ({ id, reversed: false }));

  const [entries, setEntries] = createSignal<Entry[]>(initialEntries);

  const buildConfig = (entry: Entry): SortConfig<T, TId> => {
    const base = configs[entry.id];
    if (!entry.reversed) return base;
    return {
      ...base,
      fn: (a, b) => -base.fn(a, b),
      reversed: true,
    };
  };

  const active = () => entries().map(buildConfig);

  const isActive = (id: TId): boolean => entries().some((e) => e.id === id);

  const add = (id: TId) => {
    if (!configs[id] || isActive(id)) return;
    setEntries((prev) => [...prev, { id, reversed: false }]);
  };

  const remove = (id: TId) => {
    if (!configs[id] || !isActive(id)) return;
    setEntries((prev) => prev.filter((e) => e.id !== id));
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
    const newEntries = ids
      .filter((id) => configs[id] !== undefined)
      .map((id) => ({ id, reversed: false }));
    setEntries(newEntries);
  };

  const flip = (id: TId) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, reversed: !e.reversed } : e))
    );
  };

  const clear = () => setEntries([]);

  return {
    active,
    isActive,
    toggle,
    setAll,
    flip,
    clear,
    available: configs as Record<TId, SortConfig<T>>,
  };
};

import { type Accessor, createSignal } from 'solid-js';

export type SortConfig<T> = {
  id: string;
  fn: (a: T, b: T) => number;
  desc?: boolean;
};

/** Sort state return type with strongly typed IDs */
export type SortState<T, TId extends string = string> = {
  /** Currently active sort configs (ordered by priority) */
  active: Accessor<SortConfig<T>[]>;
  isActive: (id: TId) => boolean;
  /** Toggle a sort on/off */
  toggle: (id: TId, value?: boolean) => void;
  /** Set multiple sorts by IDs (in priority order) */
  setAll: (ids: TId[]) => void;
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

  const initialSorts = (initialSortIds ?? [])
    .map((id) => configs[id])
    .filter((c) => c !== undefined);

  const [activeSorts, setActiveSorts] =
    createSignal<SortConfig<T>[]>(initialSorts);

  const isActive = (id: TId): boolean =>
    activeSorts().some((s) => s.id === configs[id]?.id);

  const add = (id: TId) => {
    const config = configs[id];
    if (!config || isActive(id)) return;
    setActiveSorts((prev) => [...prev, config]);
  };

  const remove = (id: TId) => {
    const config = configs[id];
    if (!config || !isActive(id)) return;
    setActiveSorts((prev) => prev.filter((s) => s.id !== config.id));
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
  };

  const clear = () => setActiveSorts([]);

  return {
    active: activeSorts,
    isActive,
    toggle,
    setAll,
    clear,
    available: configs as Record<TId, SortConfig<T>>,
  };
};

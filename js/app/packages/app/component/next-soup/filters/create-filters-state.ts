import type { SoupItemsQueryFilters } from '@queries/soup/items';
import { createMemo, createSignal, type Accessor } from 'solid-js';

export type FilterPredicate<T> = (entity: T) => boolean;

export type FilterConfig<T> = {
  readonly id: string;
  readonly label: string;
  readonly predicate: FilterPredicate<T>;
  readonly group?: string;
};

export type FilterGroupConfig = {
  readonly id: string;
  /** If false, only one filter from this group can be active at a time */
  readonly allowMultiple?: boolean;
};

export type FiltersStateOptions<T, TConfig extends FilterConfig<T>> = {
  configs: readonly TConfig[];
  /** Group configurations for mutual exclusivity */
  groups?: readonly FilterGroupConfig[];
  /** Initial active predicate IDs */
  initialPredicates?: string[];
  /** Initial query filters */
  initialQuery?: SoupItemsQueryFilters;
};

export type FiltersState<T, TConfig extends FilterConfig<T>> = {
  /** Current active predicate IDs */
  predicates: Accessor<string[]>;

  /** Current query filters for API */
  query: Accessor<SoupItemsQueryFilters>;

  /** Full filter configs for active predicates (for UI rendering) */
  active: Accessor<TConfig[]>;

  /** All available filter configs */
  available: readonly TConfig[];

  /** Check if a predicate ID is active */
  isActive: (id: string) => boolean;

  /** Set predicates and/or query filters (replaces, does not merge) */
  set: (options: {
    predicates?: string[];
    query?: SoupItemsQueryFilters;
  }) => void;

  /** Toggle a predicate on/off by ID */
  toggle: (id: string) => void;

  /** Activate a predicate by ID (adds to active list if not already active) */
  activate: (id: string) => void;

  /** Deactivate a predicate by ID (removes from active list) */
  deactivate: (id: string) => void;

  /** Clear all predicates and query filters */
  clear: () => void;
};

export function createFiltersState<T, TConfig extends FilterConfig<T>>(
  options: FiltersStateOptions<T, TConfig>
): FiltersState<T, TConfig> {
  const {
    configs,
    groups = [],
    initialPredicates = [],
    initialQuery = {},
  } = options;

  const configMap = new Map(configs.map((c) => [c.id, c]));
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  const [activeIds, setActiveIds] = createSignal<string[]>(initialPredicates);
  const [queryFilters, setQueryFilters] =
    createSignal<SoupItemsQueryFilters>(initialQuery);

  const active = createMemo(() =>
    activeIds()
      .map((id) => configMap.get(id))
      .filter((c): c is TConfig => c !== undefined)
  );

  const isActive = (id: string): boolean => activeIds().includes(id);

  const getConfig = (id: string): TConfig | undefined => configMap.get(id);

  const isGroupExclusive = (groupId: string): boolean => {
    const group = groupMap.get(groupId);
    return group ? group.allowMultiple !== true : false;
  };

  const getExclusiveGroupMembers = (id: string): string[] => {
    const config = getConfig(id);
    if (!config?.group) return [];

    if (!isGroupExclusive(config.group)) return [];

    return configs
      .filter((c) => c.group === config.group && c.id !== id)
      .map((c) => c.id);
  };

  const applyGroupExclusivity = (
    currentIds: string[],
    newId: string
  ): string[] => {
    const toRemove = getExclusiveGroupMembers(newId);
    if (toRemove.length === 0) {
      return [...currentIds, newId];
    }
    return [...currentIds.filter((id) => !toRemove.includes(id)), newId];
  };

  const set = (opts: {
    predicates?: string[];
    query?: SoupItemsQueryFilters;
  }) => {
    if (opts.predicates !== undefined) {
      setActiveIds(opts.predicates);
    }
    if (opts.query !== undefined) {
      setQueryFilters(opts.query);
    }
  };

  const toggle = (id: string) => {
    if (isActive(id)) {
      setActiveIds((prev) => prev.filter((x) => x !== id));
    } else {
      setActiveIds(applyGroupExclusivity(activeIds(), id));
    }
  };

  const activate = (id: string) => {
    if (!isActive(id)) {
      setActiveIds(applyGroupExclusivity(activeIds(), id));
    }
  };

  const deactivate = (id: string) => {
    if (isActive(id)) {
      setActiveIds((prev) => prev.filter((x) => x !== id));
    }
  };

  const clear = () => {
    setActiveIds([]);
    setQueryFilters({});
  };

  return {
    predicates: activeIds,
    query: queryFilters,
    active,
    available: configs,
    isActive,
    set,
    toggle,
    activate,
    deactivate,
    clear,
  };
}

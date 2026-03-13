import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { createSortState } from '@app/component/next-soup/create-sort-state';
import {
  createFilterState,
  createSoupFilters,
  SOUP_FILTER_GROUPS,
  type FilterConfig,
  type FilterGroupConfig,
  type FilterID,
} from '@app/component/next-soup/filters';
import { createSelectionState } from '@app/component/next-soup/selection-state';
import { SORT_CONFIGS } from '@app/component/next-soup/soup-view/sort-options';
import { useUserContext } from '@core/context/user';
import { isModality } from '@core/mobile/inputModality';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { EntityData, WithSearch } from '@entity';
import { createMemo, createSignal } from 'solid-js';

type SoupEntity = EntityData | WithSearch<EntityData>;

export type NavigationResult<T> = { item: T; index: number } | undefined;

export type GroupConfig<T> = {
  id: string;
  getValue: (item: T) => unknown;
};

export type SortConfig<T> = {
  id: string;
  fn: (a: T, b: T) => number;
};

interface SoupContextOptions<TId extends string = FilterID> {
  initialData?: SoupEntity[];
  initialFilters?: TId[];
  filterConfigs?: FilterConfig<SoupEntity>[];
  filterGroups?: FilterGroupConfig[];
  wrapNavigation?: boolean;
}

export const createSoupState = <TId extends string = FilterID>(
  options: SoupContextOptions<TId> = { wrapNavigation: false }
) => {
  const {
    wrapNavigation,
    initialData,
    initialFilters,
    filterConfigs,
    filterGroups,
  } = options;

  const selection = createSelectionState<SoupEntity>({
    getItemId: (i) => i.id,
  });

  const notificationSource = useGlobalNotificationSource();
  const user = useUserContext();

  const filters = createFilterState({
    filters:
      filterConfigs ??
      (createSoupFilters(
        notificationSource,
        user.userId
      ) as FilterConfig<SoupEntity>[]),
    groups: filterGroups ?? SOUP_FILTER_GROUPS,
    initialFilters,
  });

  const sort = createSortState(SORT_CONFIGS, ['updated_at']);

  const [groups, setGroups] = createSignal<GroupConfig<SoupEntity>[]>([]);

  const [data, setDataInternal] = createSignal<SoupEntity[]>(initialData ?? []);

  const setData = (newData: SoupEntity[]) => {
    setDataInternal(newData);
  };

  const [previewEntity, setPreviewEntity] = createSignal<string | undefined>();

  const [collapseEntityCallback, setCollapseEntityCallback] = createSignal<
    ((entityId: string) => Promise<void>) | undefined
  >(undefined);

  const [focusedId, setFocusedId] = createSignal<string | undefined>();

  const indexOf = (id: string): number => data().findIndex((r) => r.id === id);

  const focusedIndex = createMemo(() => {
    const id = focusedId();
    if (!id) return -1;
    return indexOf(id);
  });

  const focused = createMemo(() => {
    const index = focusedIndex();
    if (index === -1) return undefined;
    return data()[index];
  });

  const getItem = (id: string): SoupEntity | undefined =>
    data().find((e) => e.id === id);

  const getItemAt = (index: number): SoupEntity | undefined => data()[index];

  const calculateFocusItem = (index: number) => {
    const visibleRows = data();
    if (visibleRows.length === 0) return undefined;

    let targetIndex = index;
    if (targetIndex < 0) {
      targetIndex = wrapNavigation ? visibleRows.length - 1 : 0;
    } else if (targetIndex >= visibleRows.length) {
      targetIndex = wrapNavigation ? 0 : visibleRows.length - 1;
    }

    const row = visibleRows[targetIndex];
    if (!row) return undefined;

    return { item: row, index: targetIndex };
  };

  // Navigation implementation
  const setFocus = (index: number): NavigationResult<SoupEntity> => {
    // On touch devices there is no concept of a "focused entity", return early
    if (isTouchDevice()) return;

    const result = calculateFocusItem(index);

    if (result) {
      setFocusedId(result.item.id);
    }

    return result;
  };

  const peek = (offset: number) => {
    const current = focusedIndex();
    if (current === -1) {
      return calculateFocusItem(offset > 0 ? 0 : data().length - 1);
    }
    return calculateFocusItem(current + offset);
  };

  const navigateBy = (offset: number): NavigationResult<SoupEntity> => {
    const current = focusedIndex();
    if (current === -1) {
      return setFocus(offset > 0 ? 0 : data().length - 1);
    }
    return setFocus(current + offset);
  };

  const clearFocus = () => {
    setFocusedId(undefined);
  };

  return {
    data,
    setData,
    filters,
    selection,
    sort,
    groups,
    setGroups,

    focus: {
      item: focused,
      id: focusedId,
      index: focusedIndex,
      clear: clearFocus,
      set: (id: string | undefined) => setFocusedId(id),
    },

    navigate: {
      down: () => navigateBy(1),
      up: () => navigateBy(-1),
      by: navigateBy,
      toIndex: setFocus,
      toId: (id: string) => {
        const index = indexOf(id);
        if (index === -1) return undefined;
        return setFocus(index);
      },
      toFirst: () => setFocus(0),
      toLast: () => setFocus(data().length - 1),
      peekOffset: peek,
    },

    items: {
      data,
      count: () => data().length,
      get: getItem,
      at: getItemAt,
      indexOf,
    },

    previewEntity,
    setPreviewEntity,

    collapseEntity: {
      callback: collapseEntityCallback,
      set: setCollapseEntityCallback,
      shouldCollapse: () => {
        return (
          filters.isActive('not-done') &&
          collapseEntityCallback() !== undefined &&
          isModality('touch')
        );
      },
    },
  };
};

export type SoupState = ReturnType<typeof createSoupState>;

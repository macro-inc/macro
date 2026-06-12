import { createSortState } from '@app/component/next-soup/create-sort-state';
import {
  type FilterID,
  SOUP_FILTERS,
} from '@app/component/next-soup/filters/configs/';
import {
  createPredicatesStore,
  type PredicateConfig,
} from '@app/component/next-soup/filters/filter-store/predicates-store';
import { createSelectionState } from '@app/component/next-soup/selection-state';
import { SORT_CONFIGS } from '@app/component/next-soup/soup-view/sort-options';
import { isModality } from '@core/mobile/inputModality';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { EntityData, WithNotification, WithSearch } from '@entity';
import { createMemo, createSignal, type JSX } from 'solid-js';

export type SoupEntity = WithNotification<EntityData | WithSearch<EntityData>>;

export type GroupHeaderProps = {
  group: GroupMeta;
  highlighted?: boolean;
};

export type GroupMeta = {
  key: string;
  label: string;
  value: unknown;
  count: number;
  isExpanded: () => boolean;
  toggle: () => void;
  renderHeader?: (props: GroupHeaderProps) => JSX.Element;
};

export type SoupRow = {
  id: string;
  index: number;
  original: SoupEntity;
  group: GroupMeta | undefined;
  getIsGrouped: () => boolean;
  getIsLoadMore: () => boolean;
  isFocused: () => boolean;
  isSelected: () => boolean;
};

type NavigationResult = { row: SoupRow; index: number } | undefined;

export type SortConfig<T> = {
  id: string;
  fn: (a: T, b: T) => number;
};

interface SoupContextOptions<TId extends string = FilterID> {
  initialData?: SoupEntity[];
  initialPredicates?: {
    and?: TId[];
    or?: TId[];
  };
  predicateConfigs?: PredicateConfig<SoupEntity, string>[];
  wrapNavigation?: boolean;
  skipGroupHeaders?: boolean;
}

export const createSoupState = <TId extends string = FilterID>(
  options: SoupContextOptions<TId> = {}
) => {
  const {
    wrapNavigation,
    initialData,
    initialPredicates,
    predicateConfigs,
    skipGroupHeaders,
  } = options;

  const selection = createSelectionState<SoupEntity>({
    getItemId: (i) => i.id,
  });

  const predicates = createPredicatesStore({
    configs: predicateConfigs ?? SOUP_FILTERS,
    initial: initialPredicates,
  });

  const sort = createSortState(SORT_CONFIGS, ['updated_at']);

  // Tracked by index (not id) so a row id duplicated across groups highlights
  // only one occurrence. lastFocusedRowId follows that row across setRows.
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  let lastFocusedRowId: string | undefined;

  const [activeGroupId, setActiveGroupId] = createSignal<string | undefined>();

  const [collapsedGroups, setCollapsedGroups] = createSignal<Set<string>>(
    new Set()
  );

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const isGroupExpanded = (groupId: string) => !collapsedGroups().has(groupId);

  const buildRow = (options: {
    id: string;
    index: number;
    original: SoupEntity;
    group?: GroupMeta;
    isGrouped?: boolean;
    isLoadMore?: boolean;
  }): SoupRow => {
    const {
      id,
      index,
      original,
      group,
      isGrouped = false,
      isLoadMore = false,
    } = options;
    return {
      id,
      index,
      original,
      group,
      getIsGrouped: () => isGrouped,
      getIsLoadMore: () => isLoadMore,
      isFocused: () => focusedIndex() === index,
      isSelected: () =>
        !isGrouped && !isLoadMore && selection.isSelected(original.id),
    };
  };

  const [rows, setRowsInternal] = createSignal<SoupRow[]>(
    initialData?.map((e, i) => buildRow({ id: e.id, index: i, original: e })) ??
      []
  );

  const setRows = (newRows: SoupRow[]) => {
    setRowsInternal(newRows);
    if (!lastFocusedRowId) return;
    const nextIndex = newRows.findIndex((r) => r.id === lastFocusedRowId);
    setFocusedIndex(nextIndex);
    if (nextIndex < 0) lastFocusedRowId = undefined;
  };

  const [previewEntity, setPreviewEntity] = createSignal<string | undefined>();

  const [collapseEntityCallback, setCollapseEntityCallback] = createSignal<
    ((entityId: string) => Promise<void>) | undefined
  >(undefined);

  const indexOf = (id: string): number => rows().findIndex((r) => r.id === id);

  const focusedRow = createMemo(() => {
    const index = focusedIndex();
    if (index === -1) return undefined;
    return rows()[index];
  });

  const focusedId = createMemo(() => focusedRow()?.id);

  const focusedItem = createMemo(() => focusedRow()?.original);

  const getRow = (id: string): SoupRow | undefined =>
    rows().find((r) => r.id === id);

  const getRowAt = (index: number): SoupRow | undefined => rows()[index];

  const calculateFocusRow = (index: number): NavigationResult => {
    const allRows = rows();
    if (allRows.length === 0) return undefined;

    let targetIndex = index;
    if (targetIndex < 0) {
      targetIndex = wrapNavigation ? allRows.length - 1 : 0;
    } else if (targetIndex >= allRows.length) {
      targetIndex = wrapNavigation ? 0 : allRows.length - 1;
    }

    const row = allRows[targetIndex];
    if (!row) return undefined;

    return { row, index: targetIndex };
  };

  const setFocus = (index: number): NavigationResult => {
    if (isTouchDevice()) return;

    const result = calculateFocusRow(index);

    if (result) {
      setFocusedIndex(result.index);
      lastFocusedRowId = result.row.id;
    }

    return result;
  };

  const peek = (offset: number): NavigationResult => {
    const current = focusedIndex();
    if (current === -1) {
      return calculateFocusRow(offset > 0 ? 0 : rows().length - 1);
    }
    return calculateFocusRow(current + offset);
  };

  const shouldSkipRow = (row: SoupRow): boolean => {
    if (!row.group) return false;
    if (row.getIsGrouped()) {
      return !!skipGroupHeaders;
    }
    return !row.group.isExpanded();
  };

  const findNextIndex = (startIndex: number, offset: number): number => {
    const allRows = rows();
    if (allRows.length === 0) return -1;

    const direction = offset > 0 ? 1 : -1;
    let steps = Math.abs(offset);
    let cursor = startIndex;
    let lastValid = startIndex;

    while (steps > 0) {
      cursor += direction;

      if (cursor < 0 || cursor >= allRows.length) {
        if (!wrapNavigation) break;
        cursor = (cursor + allRows.length) % allRows.length;
      }

      const row = allRows[cursor];
      if (!row) break;

      if (shouldSkipRow(row)) continue;

      lastValid = cursor;
      steps--;
    }

    return lastValid;
  };

  const navigateBy = (offset: number): NavigationResult => {
    const current = focusedIndex();
    const allRows = rows();

    if (current === -1) {
      const startIndex = offset > 0 ? 0 : allRows.length - 1;
      const direction = offset > 0 ? 1 : -1;
      let i = startIndex;
      while (i >= 0 && i < allRows.length && shouldSkipRow(allRows[i])) {
        i += direction;
      }
      if (i < 0 || i >= allRows.length) return;
      return setFocus(i);
    }

    const nextIndex = findNextIndex(current, offset);
    return setFocus(nextIndex);
  };

  const clearFocus = () => {
    setFocusedIndex(-1);
    lastFocusedRowId = undefined;
  };

  return {
    rows,
    setRows,
    buildRow,
    predicates,
    selection,
    sort,
    grouping: {
      activeGroupId,
      setActiveGroupId,
      collapsedGroups,
      isExpanded: isGroupExpanded,
      toggle: toggleGroup,
      collapseAll: (ids: string[]) => setCollapsedGroups(new Set(ids)),
      expandAll: () => setCollapsedGroups(new Set<string>()),
    },

    focus: {
      row: focusedRow,
      item: focusedItem,
      id: focusedId,
      index: focusedIndex,
      clear: clearFocus,
      set: (id: string | undefined) => {
        if (id === undefined) {
          clearFocus();
          return;
        }
        const idx = indexOf(id);
        if (idx < 0) return;
        setFocusedIndex(idx);
        lastFocusedRowId = id;
      },
      setIndex: (index: number) => {
        const row = rows()[index];
        if (!row) return;
        setFocusedIndex(index);
        lastFocusedRowId = row.id;
      },
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
      toLast: () => setFocus(rows().length - 1),
      peekOffset: peek,
    },

    items: {
      rows,
      count: () => rows().length,
      get: getRow,
      at: getRowAt,
      indexOf,
    },

    previewEntity,
    setPreviewEntity,

    collapseEntity: {
      callback: collapseEntityCallback,
      set: setCollapseEntityCallback,
      shouldCollapse: () => {
        return (
          predicates.isActive('not-done') &&
          collapseEntityCallback() !== undefined &&
          isModality('touch')
        );
      },
    },
  };
};

export type SoupState = ReturnType<typeof createSoupState>;

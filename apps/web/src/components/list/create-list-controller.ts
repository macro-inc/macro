import { createMemo, createSignal } from 'solid-js';
import {
  createSelectionState,
  type SelectionState,
} from './create-selection-state';
import type {
  ListActivateOptions,
  ListActivation,
  ListActivationReason,
  ListFocusChange,
  ListFocusOptions,
  ListItemResult,
  ListItems,
  ListKey,
  ListNavigationOptions,
  ListRestoreFocusOptions,
} from './types';

export type CreateListSelectionOptions<TItem> = {
  /**
   * Logical identity used for selection and bulk actions. Defaults to the
   * rendered item key. Multiple rendered occurrences may share this key.
   */
  getKey: (item: TItem, index: number) => ListKey;
};

export type CreateListControllerOptions<TItem, TMetadata = unknown> = {
  items: () => readonly TItem[];
  /** Unique rendered occurrence identity used by focus and activation. */
  getKey: (item: TItem) => ListKey;
  selection?: CreateListSelectionOptions<TItem>;
  /** Whether keyboard focus may land on an item. */
  isNavigable?: (item: TItem, index: number) => boolean;
  /** Whether an item may participate in batch selection. */
  isSelectable?: (item: TItem, index: number) => boolean;
  wrapNavigation?: boolean;
  initialFocusKey?: ListKey;
  initialSelectedKeys?: Iterable<ListKey>;
  onFocusChange?: (change: ListFocusChange<TItem>) => void;
  onSelectionChange?: (keys: ReadonlySet<ListKey>) => void;
  onActivate?: (activation: ListActivation<TItem, TMetadata>) => void;
};

const activationFocusReason = (
  reason: ListActivationReason
): ListFocusOptions['reason'] => {
  switch (reason) {
    case 'keyboard':
      return 'keyboard';
    case 'pointer':
      return 'pointer';
    case 'programmatic':
      return 'programmatic';
  }
};

/**
 * Creates a stable, headless controller over a reactive item accessor.
 *
 * Interaction state stores keys only. Replacing item objects updates every
 * derived payload without synchronization effects, while temporarily missing
 * focus and selection anchors survive until their explicit `prune` commands.
 */
export function createListController<TItem, TMetadata = unknown>(
  options: CreateListControllerOptions<TItem, TMetadata>
) {
  const isNavigable = options.isNavigable ?? (() => true);
  const isSelectable = options.isSelectable ?? (() => true);

  const snapshot = createMemo(() => {
    const all = options.items();
    const byKey = new Map<ListKey, TItem>();
    const indexByKey = new Map<ListKey, number>();

    all.forEach((item, index) => {
      const key = options.getKey(item);
      if (byKey.has(key)) {
        throw new Error(`List items must have unique keys; received: ${key}`);
      }
      byKey.set(key, item);
      indexByKey.set(key, index);
    });

    return { all, byKey, indexByKey };
  });

  const itemResultAt = (index: number): ListItemResult<TItem> | undefined => {
    const all = snapshot().all;
    if (index < 0 || index >= all.length) return undefined;
    const item = all[index];
    return { item, index, key: options.getKey(item) };
  };

  const itemResultFor = (key: ListKey): ListItemResult<TItem> | undefined => {
    const index = snapshot().indexByKey.get(key);
    return index === undefined ? undefined : itemResultAt(index);
  };

  const items: ListItems<TItem> = {
    all: () => snapshot().all,
    count: () => snapshot().all.length,
    keyOf: options.getKey,
    get: (key) => snapshot().byKey.get(key),
    at: (index) => snapshot().all[index],
    indexOf: (key) => snapshot().indexByKey.get(key) ?? -1,
    result: itemResultFor,
  };

  const canNavigateTo = (result: ListItemResult<TItem>, force = false) =>
    force || isNavigable(result.item, result.index);

  const matchesNavigation = (
    result: ListItemResult<TItem>,
    navigationOptions: ListNavigationOptions<TItem> = {}
  ) =>
    canNavigateTo(result, navigationOptions.force) &&
    (navigationOptions.isNavigable?.(result.item, result.index) ?? true);

  const [requestedFocusKey, setRequestedFocusKey] = createSignal<
    ListKey | undefined
  >(options.initialFocusKey);
  const [forcedFocus, setForcedFocus] = createSignal(false);
  const focusedResult = createMemo(() => {
    const key = requestedFocusKey();
    if (key === undefined) return undefined;
    const result = itemResultFor(key);
    return result && canNavigateTo(result, forcedFocus()) ? result : undefined;
  });

  const commitFocus = (
    nextKey: ListKey | undefined,
    reason: NonNullable<ListFocusOptions['reason']>,
    force = false
  ) => {
    const previousKey = requestedFocusKey();
    const previousForced = forcedFocus();
    const previous = focusedResult();
    if (previousKey === nextKey && previousForced === force) return previous;

    setForcedFocus(force);
    setRequestedFocusKey(nextKey);
    const current = focusedResult();
    options.onFocusChange?.({
      current,
      previous,
      requestedKey: nextKey,
      reason,
    });
    return current;
  };

  const focusResult = (
    result: ListItemResult<TItem> | undefined,
    focusOptions: ListFocusOptions = {}
  ) => {
    if (!result || !canNavigateTo(result, focusOptions.force)) return undefined;
    commitFocus(
      result.key,
      focusOptions.reason ?? 'programmatic',
      focusOptions.force === true
    );
    return result;
  };

  const findNavigable = (
    start: number,
    direction: 1 | -1,
    navigationOptions: ListNavigationOptions<TItem> = {}
  ) => {
    const all = snapshot().all;
    for (
      let index = start;
      index >= 0 && index < all.length;
      index += direction
    ) {
      const result = itemResultAt(index);
      if (result && matchesNavigation(result, navigationOptions)) return result;
    }
    return undefined;
  };

  const focusFirst = (navigationOptions: ListNavigationOptions<TItem> = {}) =>
    focusResult(findNavigable(0, 1, navigationOptions), navigationOptions);

  const focusLast = (navigationOptions: ListNavigationOptions<TItem> = {}) =>
    focusResult(
      findNavigable(snapshot().all.length - 1, -1, navigationOptions),
      navigationOptions
    );

  const findNearest = (
    targetIndex: number,
    navigationOptions: ListNavigationOptions<TItem> = {}
  ) => {
    const all = snapshot().all;
    if (all.length === 0) return undefined;

    const center = Math.min(Math.max(targetIndex, 0), all.length - 1);
    const centered = itemResultAt(center);
    if (centered && matchesNavigation(centered, navigationOptions)) {
      return centered;
    }

    for (let distance = 1; distance < all.length; distance++) {
      const after = itemResultAt(center + distance);
      if (after && matchesNavigation(after, navigationOptions)) return after;

      const before = itemResultAt(center - distance);
      if (before && matchesNavigation(before, navigationOptions)) return before;
    }
    return undefined;
  };

  const focusNearest = (
    index: number,
    navigationOptions: ListNavigationOptions<TItem> = {}
  ) => focusResult(findNearest(index, navigationOptions), navigationOptions);

  const peekBy = (
    offset: number,
    navigationOptions: ListNavigationOptions<TItem> = {}
  ): ListItemResult<TItem> | undefined => {
    if (offset === 0) {
      const current = focusedResult();
      return current && matchesNavigation(current, navigationOptions)
        ? current
        : undefined;
    }

    const all = snapshot().all;
    if (all.length === 0) return undefined;

    if (!Number.isSafeInteger(offset)) {
      throw new RangeError('List navigation offset must be a finite integer');
    }

    const direction: 1 | -1 = offset > 0 ? 1 : -1;
    let remaining = Math.abs(offset);
    let cursor = focusedResult()?.index ?? (direction > 0 ? -1 : all.length);
    let candidate: ListItemResult<TItem> | undefined;
    let visited = 0;
    const visitLimit = all.length * remaining;

    while (remaining > 0 && visited < visitLimit) {
      cursor += direction;
      if (cursor < 0 || cursor >= all.length) {
        if (!(navigationOptions.wrap ?? options.wrapNavigation)) break;
        cursor = (cursor + all.length) % all.length;
      }

      visited += 1;
      const result = itemResultAt(cursor);
      if (!result || !matchesNavigation(result, navigationOptions)) continue;
      candidate = result;
      remaining -= 1;
    }

    return candidate;
  };

  const navigateBy = (
    offset: number,
    navigationOptions: ListNavigationOptions<TItem> = {}
  ) => {
    const target = peekBy(offset, navigationOptions);
    return focusResult(target, {
      ...navigationOptions,
      reason: navigationOptions.reason ?? 'keyboard',
    });
  };

  const restoreFocus = (
    key: ListKey | undefined,
    restoreOptions: ListRestoreFocusOptions = {}
  ) => {
    const reason = restoreOptions.reason ?? 'restore';
    if (key !== undefined) {
      const restored = focusResult(itemResultFor(key), {
        ...restoreOptions,
        reason,
      });
      if (restored) return restored;
    }

    switch (restoreOptions.fallback ?? 'none') {
      case 'first':
        return focusFirst({ ...restoreOptions, reason });
      case 'last':
        return focusLast({ ...restoreOptions, reason });
      case 'nearest':
        return focusNearest(
          restoreOptions.nearestIndex ?? focusedResult()?.index ?? 0,
          { ...restoreOptions, reason }
        );
      case 'none':
        commitFocus(
          restoreOptions.retainUnavailable !== false &&
            key !== undefined &&
            itemResultFor(key) === undefined
            ? key
            : undefined,
          reason,
          false
        );
        return undefined;
    }
  };

  const selectableResult = (rowKey: ListKey) => {
    const result = itemResultFor(rowKey);
    return result && isSelectable(result.item, result.index)
      ? result
      : undefined;
  };
  const selectionKeyForResult = (result: ListItemResult<TItem>) =>
    options.selection?.getKey(result.item, result.index) ?? result.key;
  const selectableBySelectionKey = createMemo(() => {
    const results = new Map<ListKey, ListItemResult<TItem>>();
    snapshot().all.forEach((_item, index) => {
      const result = itemResultAt(index);
      if (!result || !isSelectable(result.item, result.index)) return;
      const selectionKey = selectionKeyForResult(result);
      if (!results.has(selectionKey)) results.set(selectionKey, result);
    });
    return results;
  });
  const keySelection: SelectionState<ListItemResult<TItem>> =
    createSelectionState({
      items: () => [...selectableBySelectionKey().values()],
      getKey: selectionKeyForResult,
      initialKeys: options.initialSelectedKeys,
      onChange: options.onSelectionChange,
    });

  const effectiveSelectionKeys = createMemo<ReadonlySet<ListKey>>(
    () =>
      new Set(
        [...keySelection.keys()].filter((key) =>
          selectableBySelectionKey().has(key)
        )
      )
  );
  const effectiveSelectionItems = createMemo(() =>
    [...effectiveSelectionKeys()].flatMap((key) => {
      const result = selectableBySelectionKey().get(key);
      return result ? [result.item] : [];
    })
  );
  const selectionKeyForRow = (rowKey: ListKey) => {
    const result = selectableResult(rowKey);
    return result ? selectionKeyForResult(result) : undefined;
  };
  const isSelectionKeySelected = (selectionKey: ListKey) =>
    effectiveSelectionKeys().has(selectionKey);
  const isRowSelected = (rowKey: ListKey) => {
    const selectionKey = selectionKeyForRow(rowKey);
    return selectionKey !== undefined && isSelectionKeySelected(selectionKey);
  };

  const replaceSelected = (keys: Iterable<ListKey>) => {
    keySelection.replace(
      [...keys].filter((key) => selectableBySelectionKey().has(key))
    );
  };

  const selectRange = (
    fromKey: ListKey,
    toKey: ListKey,
    selected = true,
    baseline: Iterable<ListKey> = keySelection.keys()
  ) => {
    const from = items.indexOf(fromKey);
    const to = items.indexOf(toKey);
    if (from < 0 || to < 0) return;

    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const next = new Set(baseline);
    for (let index = start; index <= end; index++) {
      const result = itemResultAt(index);
      if (!result || !isSelectable(result.item, result.index)) continue;
      const selectionKey = selectionKeyForResult(result);
      if (selected) next.add(selectionKey);
      else next.delete(selectionKey);
    }
    keySelection.replace(next);
  };

  const visibleSelectionKeys = createMemo(
    () => new Set(selectableBySelectionKey().keys())
  );
  const allVisibleSelected = () => {
    const visible = visibleSelectionKeys();
    return (
      visible.size > 0 &&
      [...visible].every((key) => effectiveSelectionKeys().has(key))
    );
  };
  const selectAllVisible = () => keySelection.add(visibleSelectionKeys());
  const toggleAllVisible = () => {
    if (allVisibleSelected()) {
      const visible = visibleSelectionKeys();
      keySelection.replace(
        [...keySelection.keys()].filter((key) => !visible.has(key))
      );
      return;
    }
    selectAllVisible();
  };

  const focusOptionsForActivation = (
    activateOptions: ListActivateOptions<TMetadata>,
    defaultFocus: boolean
  ): ListFocusOptions | undefined => {
    const requested = activateOptions.focus;
    if (requested === false || (requested === undefined && !defaultFocus)) {
      return undefined;
    }

    const reason = activationFocusReason(
      activateOptions.reason ?? 'programmatic'
    );
    if (requested === undefined || requested === true) return { reason };
    return { ...requested, reason: requested.reason ?? reason };
  };

  const activateResult = (
    result: ListItemResult<TItem> | undefined,
    activateOptions: ListActivateOptions<TMetadata> = {},
    defaultFocus = true
  ) => {
    if (!result) return undefined;

    const focusOptions = focusOptionsForActivation(
      activateOptions,
      defaultFocus
    );
    if (focusOptions) focusResult(result, focusOptions);

    const activation: ListActivation<TItem, TMetadata> = {
      ...result,
      reason: activateOptions.reason ?? 'programmatic',
      ...(activateOptions.metadata === undefined
        ? {}
        : { metadata: activateOptions.metadata }),
    };
    options.onActivate?.(activation);
    return activation;
  };

  return {
    items,
    focus: {
      requestedKey: requestedFocusKey,
      key: () => focusedResult()?.key,
      item: () => focusedResult()?.item,
      index: () => focusedResult()?.index ?? -1,
      result: focusedResult,
      isNavigable: (key: ListKey) => {
        const result = itemResultFor(key);
        return result !== undefined && canNavigateTo(result);
      },
      set: (key: ListKey, focusOptions?: ListFocusOptions) =>
        focusResult(itemResultFor(key), focusOptions),
      setIndex: (index: number, focusOptions?: ListFocusOptions) =>
        focusResult(itemResultAt(index), focusOptions),
      request: (
        key: ListKey | undefined,
        focusOptions: ListFocusOptions = {}
      ) =>
        commitFocus(
          key,
          focusOptions.reason ?? 'programmatic',
          focusOptions.force === true
        ),
      restore: restoreFocus,
      first: focusFirst,
      last: focusLast,
      nearest: focusNearest,
      clear: (focusOptions: ListFocusOptions = {}) =>
        commitFocus(undefined, focusOptions.reason ?? 'programmatic'),
      prune: (focusOptions: ListFocusOptions = {}) => {
        const key = requestedFocusKey();
        if (key === undefined || focusedResult()) return;
        commitFocus(undefined, focusOptions.reason ?? 'programmatic');
      },
    },
    navigate: {
      down: (navigationOptions?: ListNavigationOptions<TItem>) =>
        navigateBy(1, navigationOptions),
      up: (navigationOptions?: ListNavigationOptions<TItem>) =>
        navigateBy(-1, navigationOptions),
      by: navigateBy,
      toKey: (key: ListKey, focusOptions: ListFocusOptions = {}) =>
        focusResult(itemResultFor(key), {
          ...focusOptions,
          reason: focusOptions.reason ?? 'keyboard',
        }),
      toIndex: (index: number, focusOptions: ListFocusOptions = {}) =>
        focusResult(itemResultAt(index), {
          ...focusOptions,
          reason: focusOptions.reason ?? 'keyboard',
        }),
      toFirst: (navigationOptions: ListNavigationOptions<TItem> = {}) =>
        focusFirst({
          ...navigationOptions,
          reason: navigationOptions.reason ?? 'keyboard',
        }),
      toLast: (navigationOptions: ListNavigationOptions<TItem> = {}) =>
        focusLast({
          ...navigationOptions,
          reason: navigationOptions.reason ?? 'keyboard',
        }),
      peekBy,
    },
    activate: {
      current: (activateOptions?: ListActivateOptions<TMetadata>) =>
        activateResult(focusedResult(), activateOptions, false),
      key: (key: ListKey, activateOptions?: ListActivateOptions<TMetadata>) =>
        activateResult(itemResultFor(key), activateOptions, true),
      index: (
        index: number,
        activateOptions?: ListActivateOptions<TMetadata>
      ) => activateResult(itemResultAt(index), activateOptions, true),
    },
    selection: {
      /** Requested logical keys, including identities awaiting item payloads. */
      requestedKeys: keySelection.keys,
      /** Currently resolved logical selection identities. */
      keys: effectiveSelectionKeys,
      /** One current selectable payload per logical selection identity. */
      items: effectiveSelectionItems,
      missingKeys: keySelection.missingKeys,
      count: () => effectiveSelectionKeys().size,
      keyForRow: selectionKeyForRow,
      isSelectable: (rowKey: ListKey) => selectableResult(rowKey) !== undefined,
      isSelected: isRowSelected,
      isKeySelected: isSelectionKeySelected,
      select: (rowKey: ListKey) => {
        const selectionKey = selectionKeyForRow(rowKey);
        if (selectionKey !== undefined) keySelection.select(selectionKey);
      },
      deselect: (rowKey: ListKey) => {
        const selectionKey = selectionKeyForRow(rowKey);
        if (selectionKey !== undefined) keySelection.deselect(selectionKey);
      },
      toggle: (rowKey: ListKey) => {
        const selectionKey = selectionKeyForRow(rowKey);
        if (selectionKey === undefined) return;
        keySelection.toggle(selectionKey);
      },
      selectKey: (selectionKey: ListKey) => {
        if (selectableBySelectionKey().has(selectionKey)) {
          keySelection.select(selectionKey);
        }
      },
      deselectKey: keySelection.deselect,
      toggleKey: (selectionKey: ListKey) => {
        if (selectableBySelectionKey().has(selectionKey)) {
          keySelection.toggle(selectionKey);
        }
      },
      /** Add currently resolved logical selection identities. */
      add: (keys: Iterable<ListKey>) =>
        keySelection.add(
          [...keys].filter((key) => selectableBySelectionKey().has(key))
        ),
      replace: replaceSelected,
      /** Restore logical keys before their item payloads are available. */
      restore: keySelection.replace,
      selectRange,
      visibleKeys: visibleSelectionKeys,
      allVisibleSelected,
      selectAllVisible,
      toggleAllVisible,
      clear: keySelection.clear,
      prune: keySelection.prune,
    },
  };
}

/** Headless list controller returned by `createListController`. */
export type ListController<TItem, TMetadata = unknown> = ReturnType<
  typeof createListController<TItem, TMetadata>
>;

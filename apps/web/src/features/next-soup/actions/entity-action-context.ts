import type { ListController } from '@app/components/list';
import { isListViewID } from '@app/constants/list-views';
import type { EntityData } from '@entity';
import type { SoupRow, SoupState } from '../create-soup-state';
import { canExecuteMarkDoneOnView } from './make-mark-done-action';

type MaybePromise<T> = T | Promise<T>;

export type EntityActionSenderBucket = 'signal' | 'noise';

export type EntityActionViewContext = {
  supportsMarkDone: boolean;
  senderBucket: EntityActionSenderBucket | undefined;
};

/** Soup list capabilities used by entity actions. */
export type EntityActionListState = {
  focus: Pick<SoupState['focus'], 'id' | 'index' | 'set'>;
  navigate: Pick<SoupState['navigate'], 'peekOffset'>;
  items: Pick<SoupState['items'], 'count' | 'get' | 'at'>;
  selection: Pick<SoupState['selection'], 'clear'>;
  collapseEntity: Pick<
    SoupState['collapseEntity'],
    'callback' | 'shouldCollapse'
  >;
};

export type EntityActionListFocusTarget = {
  key: string;
  index: number;
  entity: EntityData;
};

export type ToEntityActionListStateOptions<TItem, TMetadata> = {
  controller: ListController<TItem, TMetadata>;
  getEntity: (item: TItem) => EntityData | undefined;
  onFocus?: (
    target: EntityActionListFocusTarget | undefined
  ) => MaybePromise<void>;
  collapse?: {
    enabled: () => boolean;
    run: (entityId: string) => Promise<void>;
  };
};

type AdaptedRow = {
  row: SoupRow;
  controllerIndex: number;
  entity: EntityData;
};

function resolveSenderBucket(
  activeTab: string | undefined
): EntityActionSenderBucket | undefined {
  if (activeTab === 'noise') return 'noise';

  if (
    activeTab === undefined ||
    activeTab === 'signal' ||
    activeTab === 'important'
  ) {
    return 'signal';
  }

  return undefined;
}

export function resolveEntityActionViewContext(options: {
  activeListView: string;
  activeTab: string | undefined;
}): EntityActionViewContext {
  const { activeListView, activeTab } = options;

  return {
    supportsMarkDone:
      activeTab !== undefined &&
      isListViewID(activeListView) &&
      canExecuteMarkDoneOnView(activeListView, activeTab),
    senderBucket: resolveSenderBucket(activeTab),
  };
}

/**
 * Adapts a generic list controller to the narrow Soup-shaped state consumed by
 * entity actions.
 */
export function toEntityActionListState<TItem, TMetadata>(
  options: ToEntityActionListStateOptions<TItem, TMetadata>
): EntityActionListState {
  const { controller } = options;

  const rows = (): AdaptedRow[] => {
    const result: AdaptedRow[] = [];

    controller.items.all().forEach((item, controllerIndex) => {
      const entity = options.getEntity(item);
      if (!entity) return;

      const key = controller.items.keyOf(item);
      const row: SoupRow = {
        identityKey: key,
        id: key,
        index: result.length,
        original: entity,
        group: undefined,
        getIsGrouped: () => false,
        getIsLoadMore: () => false,
        isFocused: () => controller.focus.key() === key,
        isSelected: () => controller.selection.isSelected(key),
      };
      result.push({ row, controllerIndex, entity });
    });

    return result;
  };

  const focusedRow = () => {
    const key = controller.focus.key();
    if (key === undefined) return undefined;

    return rows().find(({ row }) => row.id === key);
  };

  const getRow = (id: string) => {
    const allRows = rows();
    return (
      allRows.find(({ row }) => row.id === id) ??
      allRows.find(({ entity }) => entity.id === id)
    );
  };

  const setFocus = (id: string | undefined) => {
    if (id === undefined) {
      controller.focus.clear({ reason: 'programmatic' });
      void options.onFocus?.(undefined);
      return;
    }

    const target = getRow(id);
    if (!target) return;

    const focused = controller.focus.set(target.row.id, {
      reason: 'programmatic',
      force: true,
    });
    if (!focused) return;

    void options.onFocus?.({
      key: focused.key,
      index: target.controllerIndex,
      entity: target.entity,
    });
  };

  const peekOffset: EntityActionListState['navigate']['peekOffset'] = (
    offset,
    navigationOptions
  ) => {
    if (!Number.isSafeInteger(offset)) {
      throw new RangeError('List navigation offset must be a finite integer');
    }

    const allRows = rows();
    if (allRows.length === 0) return undefined;

    const shouldSkip = (row: SoupRow) =>
      navigationOptions?.skip?.(row) ?? false;
    const currentIndex = focusedRow()?.row.index ?? -1;

    if (offset === 0) {
      const current = allRows[currentIndex];
      return current && !shouldSkip(current.row)
        ? { row: current.row, index: currentIndex }
        : undefined;
    }

    const direction = offset > 0 ? 1 : -1;
    if (currentIndex === -1) {
      let index = direction > 0 ? 0 : allRows.length - 1;
      while (index >= 0 && index < allRows.length) {
        const candidate = allRows[index];
        if (candidate && !shouldSkip(candidate.row)) {
          return { row: candidate.row, index };
        }
        index += direction;
      }
      return undefined;
    }

    let remaining = Math.abs(offset);
    let cursor = currentIndex;
    let lastValid = shouldSkip(allRows[currentIndex]?.row) ? -1 : currentIndex;
    let iterations = 0;
    const iterationLimit = allRows.length * remaining;
    const shouldWrap = navigationOptions?.wrapNavigation ?? false;

    while (remaining > 0 && iterations < iterationLimit) {
      iterations += 1;
      cursor += direction;

      if (cursor < 0 || cursor >= allRows.length) {
        if (!shouldWrap) break;
        cursor = (cursor + allRows.length) % allRows.length;
      }

      const candidate = allRows[cursor];
      if (!candidate || shouldSkip(candidate.row)) continue;

      lastValid = cursor;
      remaining -= 1;
    }

    const result = allRows[lastValid];
    return result ? { row: result.row, index: lastValid } : undefined;
  };

  const collapseCallback = () => {
    const collapse = options.collapse;
    return collapse ? (entityId: string) => collapse.run(entityId) : undefined;
  };

  return {
    focus: {
      id: () => focusedRow()?.row.id,
      index: () => focusedRow()?.row.index ?? -1,
      set: setFocus,
    },
    navigate: {
      peekOffset,
    },
    items: {
      count: () => rows().length,
      get: (id) => getRow(id)?.row,
      at: (index) => rows()[index]?.row,
    },
    selection: {
      clear: controller.selection.clear,
    },
    collapseEntity: {
      callback: collapseCallback,
      shouldCollapse: () => options.collapse?.enabled() ?? false,
    },
  };
}

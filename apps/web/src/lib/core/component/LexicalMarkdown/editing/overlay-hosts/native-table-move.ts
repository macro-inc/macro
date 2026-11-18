import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { Accessor } from 'solid-js';
import {
  type NativeTableFacts,
  type NativeTableKey,
  readNativeTableFacts,
} from '../../plugins/tables/nativeFacts';
import { createNativeListenerScope } from './native-listeners';
import { nativeTableCellFromTarget } from './native-table-dom';
import {
  type NativeTableEditOutcome,
  settleNativeTableEdit,
} from './native-table-edit';
import type {
  TableMoveCells,
  TableMoveHost,
  TableMoveMenuAction,
  TableMoveShape,
} from './table-move';

/**
 * The shared view ignores edit results; native callers that need them (tests,
 * the select-cells consumer) await the input's own outcome instead.
 */
export type NativeTableMoveHost = Omit<
  TableMoveHost<NativeTableKey>,
  'move' | 'selectCells' | 'menuAction'
> & {
  move(
    cells: TableMoveCells<NativeTableKey> | undefined,
    target: HTMLElement
  ): Promise<NativeTableEditOutcome>;
  selectCells(
    cells: TableMoveCells<NativeTableKey> | undefined
  ): Promise<NativeTableEditOutcome>;
  menuAction(
    action: TableMoveMenuAction,
    tracked: TableMoveCells<NativeTableKey> | undefined
  ): Promise<NativeTableEditOutcome>;
  dispose(): void;
};

const REFUSED: NativeTableEditOutcome = Object.freeze({ kind: 'refused' });

/**
 * The native backend for the shared TableMoveHandle. Reads come from the
 * mirror and the authoritative table facts. Each edit is one SessionEdit
 * input (move-cells, select-cells, menu-action) whose cells and editability
 * are rechecked at actual entry; native rechecks them again in the model.
 */
export function createNativeTableMoveHost(
  view: EditorView,
  canEdit: Accessor<boolean>
): NativeTableMoveHost {
  const scope = createNativeListenerScope();
  let disposed = false;
  /** Own one registration; its cleanup runs at most once, inside the scope. */
  const register = (install: () => () => void) => {
    if (disposed) throw new Error('Table move host is disposed');
    let cleanup: (() => void) | undefined;
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      cleanup?.();
    };
    scope.add(release);
    try {
      cleanup = install();
      return release;
    } catch (error) {
      disposed = true;
      return scope.fail(error);
    }
  };
  /** A listener that stops notifying once released or the host is disposed. */
  const guarded = <Args extends unknown[]>(
    listener: (...args: Args) => void
  ) => {
    let live = true;
    return {
      notify: (...args: Args) => {
        if (live && !disposed) listener(...args);
      },
      stop: () => {
        live = false;
      },
    };
  };
  const mounted = () => !disposed && view.isMounted;
  const editable = () =>
    mounted() && canEdit() && view.root.contentEditable === 'true';
  const keyOf = (index: number): NativeTableKey | undefined => {
    const generation = view.mirror.keyGeneration;
    return generation === null ? undefined : { index, generation };
  };
  const live = (key: NativeTableKey | undefined): key is NativeTableKey =>
    mounted() &&
    !!key &&
    key.generation === view.mirror.keyGeneration &&
    view.node(key.index)?.type === 'tablecell';
  /** The table cell at or above a node, as Source $getTableCellNodeFromLexicalNode. */
  const cellOf = (index: number): number | undefined => {
    let node = view.node(index);
    while (node) {
      if (node.type === 'tablecell') return node.key;
      node = node.parent === null ? null : view.node(node.parent);
    }
  };
  /** The facts of the table holding `cell`, and that cell's placement in it. */
  const placement = (cell: NativeTableKey) => {
    if (!live(cell)) return;
    let table = view.node(cell.index);
    while (table && table.type !== 'table')
      table = table.parent === null ? null : view.node(table.parent);
    if (!table) return;
    const facts: NativeTableFacts | undefined = readNativeTableFacts(view, {
      index: table.key,
      generation: cell.generation,
    });
    const placed = facts?.cells.find((entry) => entry.key.index === cell.index);
    return facts && placed ? { facts, placed } : undefined;
  };
  /** Source trackedFrom: each corner resolves on its own; merged comes from the anchor alone. */
  const tracked = (
    anchor: number | undefined,
    focus: number | undefined
  ): TableMoveCells<NativeTableKey> => {
    const anchorKey = anchor === undefined ? undefined : keyOf(anchor);
    const placed = anchorKey && placement(anchorKey)?.placed;
    return {
      anchor: anchorKey,
      focus: focus === undefined ? undefined : keyOf(focus),
      merged: !!placed && (placed.colSpan > 1 || placed.rowSpan > 1),
    };
  };
  const onCommit = (listener: () => void) => {
    const { notify, stop } = guarded(listener);
    return register(() => {
      const release = view.onCommit(() => notify());
      return () => {
        stop();
        release();
      };
    });
  };

  return {
    trackedCells() {
      if (!mounted()) return;
      const selection = view.selection().selection;
      if (!selection) return;
      if (selection.kind === 'table')
        return tracked(
          cellOf(selection.anchorCell),
          cellOf(selection.focusCell)
        );
      if (selection.kind === 'range') {
        // A caret outside every table hides the handle (interface contract).
        const cell = cellOf(selection.anchor.key);
        return cell === undefined ? undefined : tracked(cell, cell);
      }
      return;
    },
    registerSelection: onCommit,
    registerLayout: onCommit,
    registerFocus(listener) {
      const { notify, stop } = guarded(listener);
      return register(() => {
        const root = view.root;
        const focus = () => notify(true);
        const blur = () => notify(false);
        root.addEventListener('focus', focus);
        root.addEventListener('blur', blur);
        return () => {
          stop();
          root.removeEventListener('focus', focus);
          root.removeEventListener('blur', blur);
        };
      });
    },
    rootElement() {
      return mounted() ? view.root : null;
    },
    elementFor(key) {
      if (!live(key)) return;
      return view.getElementByKey(key.index) ?? undefined;
    },
    cellElementFromTarget(target) {
      if (!mounted()) return;
      return nativeTableCellFromTarget(view, target);
    },
    shape(cells) {
      const fallback: TableMoveShape = { rows: 1, columns: 1 };
      const anchorKey = cells?.anchor;
      const focusKey = cells?.focus;
      if (!live(anchorKey) || !live(focusKey)) return fallback;
      const anchor = placement(anchorKey);
      const focus = placement(focusKey);
      if (!anchor || !focus || anchor.facts.key.index !== focus.facts.key.index)
        return fallback;
      const a = anchor.placed;
      const f = focus.placed;
      const minRow = Math.min(a.row, f.row);
      const maxRow = Math.max(a.row + a.rowSpan - 1, f.row + f.rowSpan - 1);
      const minColumn = Math.min(a.column, f.column);
      const maxColumn = Math.max(
        a.column + a.colSpan - 1,
        f.column + f.colSpan - 1
      );
      return { rows: maxRow - minRow + 1, columns: maxColumn - minColumn + 1 };
    },
    previewRect(target, shape) {
      const cellRect = target.getBoundingClientRect();
      const index = mounted() ? view.keyFromDOM(target) : null;
      const key = index === null ? undefined : keyOf(index);
      const reference = key && placement(key);
      if (!reference) return cellRect;
      const { facts, placed } = reference;
      const lastRow = facts.rowCount - 1;
      const lastColumn = Math.max(facts.columnCount - 1, 0);
      const endColumn = Math.min(placed.column + shape.columns - 1, lastColumn);
      const wantedEndRow = placed.row + shape.rows - 1;
      const endRow = Math.min(wantedEndRow, lastRow);
      const endKey = facts.slots[endRow]?.[endColumn];
      const endElement = endKey
        ? view.getElementByKey(endKey.index)
        : undefined;
      const endRect = endElement?.getBoundingClientRect() ?? cellRect;
      const left = Math.min(cellRect.left, endRect.left);
      const top = Math.min(cellRect.top, endRect.top);
      const right = Math.max(cellRect.right, endRect.right);
      // Rows the move would append extend the preview past the table.
      const bottom =
        Math.max(cellRect.bottom, endRect.bottom) +
        (wantedEndRow - endRow) * cellRect.height;
      return { left, top, width: right - left, height: bottom - top };
    },
    async move(cells, target) {
      const anchor = cells?.anchor;
      const focus = cells?.focus;
      const element = mounted()
        ? nativeTableCellFromTarget(view, target)
        : undefined;
      const index = element ? view.keyFromDOM(element) : null;
      const destination = index === null ? undefined : keyOf(index);
      if (!editable() || !live(anchor) || !live(focus) || !live(destination))
        return REFUSED;
      return settleNativeTableEdit(
        view,
        'move-cells',
        () => ({
          action: 'move-cells',
          anchor: anchor.index,
          focus: focus.index,
          target: destination.index,
        }),
        () => editable() && live(anchor) && live(focus) && live(destination)
      );
    },
    async selectCells(cells) {
      if (!editable()) return REFUSED;
      const anchor = cells?.anchor;
      const focus = cells?.focus;
      // Source still runs its update (and fires SELECTION_CHANGE) with missing
      // corners; native sends the corners it still has and decides in the model.
      return settleNativeTableEdit(
        view,
        'select-cells',
        () => ({
          action: 'select-cells',
          ...(live(anchor) ? { anchor: anchor.index } : {}),
          ...(live(focus) ? { focus: focus.index } : {}),
        }),
        editable
      );
    },
    async menuAction(action, cells) {
      if (!editable()) return REFUSED;
      const anchor = cells?.anchor;
      return settleNativeTableEdit(
        view,
        'menu-action',
        () => ({
          action: 'menu-action',
          item: action,
          ...(live(anchor) ? { tracked: anchor.index } : {}),
        }),
        editable
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scope.dispose();
    },
  };
}

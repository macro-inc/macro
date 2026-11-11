import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import type { Accessor } from 'solid-js';
import {
  deleteNativeTableAtHover,
  insertNativeTableAxis,
} from '../../plugins/tables/native';
import {
  type NativeTableKey,
  readNativeTableFacts,
} from '../../plugins/tables/nativeFacts';
import { createNativeListenerScope } from './native-listeners';
import { nativeTableCellFromTarget } from './native-table-dom';
import { cellDeletePixels, type TableDeleteHost } from './table-delete';
import type { TableInsertHost } from './table-insert';

type Hit = { element: HTMLElement; key: NativeTableKey };
export function createNativeTableHoverHost(
  view: EditorView,
  canEdit: Accessor<boolean>,
  onUnavailable?: (error: unknown) => void
): {
  insertHost: TableInsertHost<NativeTableKey, Hit>;
  deleteHost: TableDeleteHost<Hit>;
  dispose(): void;
} {
  const scope = createNativeListenerScope();
  let disposed = false;
  const unavailable = (error: unknown) => {
    disposed = true;
    try {
      scope.fail(error);
    } catch (primary) {
      if (!onUnavailable) throw primary;
      try {
        onUnavailable(primary);
      } catch (secondary) {
        for (const failure of [primary, secondary]) {
          try {
            Telemetry.error(failure, { surface: 'native-table-hover' });
          } catch {
            // Reporting failures cannot replace the original query cause.
          }
        }
      }
    }
  };
  const own = (cleanup: () => void) => {
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      cleanup();
    };
    scope.add(release);
    return release;
  };
  const register = (add: () => void, remove: () => void) => {
    if (disposed) throw new Error('Table hover host is disposed');
    const release = own(remove);
    try {
      add();
      return release;
    } catch (error) {
      disposed = true;
      return scope.fail(error);
    }
  };

  const factsForCell = (hit: Hit) => {
    if (
      disposed ||
      !view.isMounted ||
      hit.key.generation !== view.mirror.keyGeneration
    )
      return;
    const tableElement = hit.element.closest('table');
    if (!tableElement || !view.ownsEvent(tableElement, true)) return;
    const index = view.keyFromDOM(tableElement);
    if (index === null || view.node(index)?.type !== 'table') return;
    let facts: ReturnType<typeof readNativeTableFacts>;
    try {
      facts = readNativeTableFacts(view, {
        index,
        generation: hit.key.generation,
      });
    } catch (error) {
      unavailable(error);
      return;
    }
    const cell = facts?.cells.find((cell) => cell.key.index === hit.key.index);
    if (!facts || !cell) return;
    return { facts, cell, tableElement };
  };

  const host: TableInsertHost<NativeTableKey, Hit> = {
    cellFromTarget(target) {
      const window = view.root.ownerDocument.defaultView;
      if (
        disposed ||
        !view.isMounted ||
        !window ||
        !(target instanceof window.HTMLElement) ||
        !view.ownsEvent(target, true)
      )
        return null;
      const element = nativeTableCellFromTarget(view, target);
      if (!element) return;
      const index = view.keyFromDOM(element),
        generation = view.mirror.keyGeneration;
      if (
        index === null ||
        generation === null ||
        view.getElementByKey(index) !== element
      )
        return;
      return { element, key: { index, generation } };
    },
    referenceForBorder(hit, axis, side) {
      const reference = factsForCell(hit);
      if (!reference) return;
      const { facts, cell, tableElement } = reference;
      let key = cell.key;
      if (side === 'start') {
        const previous =
          axis === 'row'
            ? cell.row > 0
              ? facts.slots[cell.row - 1]?.[cell.column]
              : undefined
            : cell.column > 0
              ? facts.slots[cell.row]?.[cell.column - 1]
              : undefined;
        if (!previous) return;
        key = previous;
      }
      return { key, table: tableElement };
    },
    insertAfter(key, axis) {
      if (
        disposed ||
        !view.isMounted ||
        !canEdit() ||
        view.root.contentEditable !== 'true' ||
        key.generation !== view.mirror.keyGeneration
      )
        return 'clear-target';
      const span =
        view.options.parentSpan?.span('editor.table.insert.dispatch') ??
        Telemetry.span('editor.table.insert.dispatch');
      try {
        span.setAttr('axis', axis);
        span.run(() => insertNativeTableAxis(view, key.index, axis, true));
      } finally {
        span.end();
      }
      return 'clear-target';
    },
    registerRoot(listener) {
      return register(
        () => view.root.addEventListener('pointermove', listener),
        () => view.root.removeEventListener('pointermove', listener)
      );
    },
    registerScroll(listener) {
      const document = view.root.ownerDocument;
      return register(
        () =>
          document.addEventListener('scroll', listener, {
            capture: true,
            passive: true,
          }),
        () =>
          document.removeEventListener('scroll', listener, { capture: true })
      );
    },
  };
  return {
    insertHost: host,
    deleteHost: {
      cellFromTarget: host.cellFromTarget,
      registerRoot: host.registerRoot,
      registerScroll: host.registerScroll,
      selectionPixels(hit, rect) {
        const pixels = cellDeletePixels(rect);
        const reference = factsForCell(hit);
        const extent = reference?.facts.selection?.deleteExtent;
        if (!reference || !extent) return pixels;
        const { facts, cell } = reference;
        if (cell.selectionDelete?.expandRows) {
          const min = facts.rows[extent.minRow];
          const max = facts.rows[extent.maxRow];
          const first = min && view.getElementByKey(min.key.index);
          const last = max && view.getElementByKey(max.key.index);
          if (first && last) {
            const a = first.getBoundingClientRect();
            const b = last.getBoundingClientRect();
            pixels.deleteRowTop = Math.min(a.top, b.top);
            pixels.deleteRowBottom = Math.max(a.bottom, b.bottom);
            pixels.selectedRowCount = extent.maxRow - extent.minRow + 1;
          }
        }
        if (cell.selectionDelete?.expandColumns) {
          const min = facts.slots[cell.row]?.[extent.minColumn];
          const max = facts.slots[cell.row]?.[extent.maxColumn];
          const first = min && view.getElementByKey(min.index);
          const last = max && view.getElementByKey(max.index);
          if (first && last) {
            const a = first.getBoundingClientRect();
            const b = last.getBoundingClientRect();
            pixels.deleteColLeft = Math.min(a.left, b.left);
            pixels.deleteColRight = Math.max(a.right, b.right);
            pixels.selectedColumnCount =
              extent.maxColumn - extent.minColumn + 1;
          }
        }
        return pixels;
      },
      deleteAt(hit, axis) {
        if (
          !disposed &&
          view.isMounted &&
          canEdit() &&
          view.root.contentEditable === 'true' &&
          hit.key.generation === view.mirror.keyGeneration
        ) {
          const span =
            view.options.parentSpan?.span('editor.table.delete.dispatch') ??
            Telemetry.span('editor.table.delete.dispatch');
          try {
            span.setAttr('axis', axis);
            span.run(() => deleteNativeTableAtHover(view, hit.key.index, axis));
          } finally {
            span.end();
          }
        }
        return 'clear-target';
      },
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scope.dispose();
    },
  };
}

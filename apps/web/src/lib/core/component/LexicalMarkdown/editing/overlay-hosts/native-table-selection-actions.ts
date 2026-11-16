import { fireAndForget } from '@core/util/fireAndForget';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { readSelection } from '@macro-inc/lexical-wasm-view/view/selection';
import type { Accessor } from 'solid-js';
import { dispatchApplicationCommand } from '../../plugins/group-b/command';
import { readNativeTableFacts } from '../../plugins/tables/nativeFacts';
import {
  type NativeTableEditOutcome,
  settleNativeTableEdit,
} from './native-table-edit';
import type {
  TableSelectionActionsHost,
  TableSelectionCells,
} from './table-selection-actions';

/** Merge and split also report their own input outcome to native callers. */
export type NativeTableSelectionActionsHost = Omit<
  TableSelectionActionsHost<number>,
  'merge' | 'split' | 'paste'
> & {
  merge(): Promise<NativeTableEditOutcome>;
  split(): Promise<NativeTableEditOutcome>;
  /** Settles once the paste and the selection collapse are done; never rejects. */
  paste(data: DataTransfer): Promise<void>;
};

const REFUSED: NativeTableEditOutcome = Object.freeze({ kind: 'refused' });

/**
 * The native backend for the shared touch table selection action bar. Reads
 * come from the published selection, the mirror and the authoritative table
 * facts; merge, split and clear are native model commands.
 */
export function createNativeTableSelectionActionsHost(
  view: EditorView,
  canEdit: Accessor<boolean>
): NativeTableSelectionActionsHost {
  const editable = () =>
    view.isMounted && canEdit() && view.root.contentEditable === 'true';
  /** The table cell at or above a node, as Source $getTableCellNodeFromLexicalNode. */
  const cellOf = (index: number): number | undefined => {
    let node = view.node(index);
    while (node) {
      if (node.type === 'tablecell') return node.key;
      node = node.parent === null ? null : view.node(node.parent);
    }
  };
  const tableSelection = () => {
    if (!view.isMounted) return;
    const selection = view.selection().selection;
    return selection.kind === 'table' ? selection : undefined;
  };
  /** One SessionEdit table input, rechecked at actual entry. */
  const edit = (action: 'selection-merge' | 'selection-split') =>
    editable()
      ? settleNativeTableEdit(view, action, () => ({ action }), editable)
      : Promise.resolve(REFUSED);
  const onCommit = (listener: () => void) =>
    view.onCommit(() => {
      listener();
    });
  return {
    tracked(): TableSelectionCells<number> | undefined {
      const selection = tableSelection();
      const generation = view.mirror.keyGeneration;
      if (!selection || generation === null) return;
      if (
        view.node(selection.anchorCell) === null ||
        view.node(selection.focusCell) === null
      )
        return;
      const facts = readNativeTableFacts(view, {
        index: selection.table,
        generation,
      });
      const selected = new Set(
        facts?.selection?.selectedCellKeys.map((key) => key.index) ?? []
      );
      return {
        anchor: cellOf(selection.anchorCell),
        focus: cellOf(selection.focusCell),
        merged:
          facts?.cells.some(
            (cell) =>
              selected.has(cell.key.index) &&
              (cell.colSpan > 1 || cell.rowSpan > 1)
          ) ?? false,
      };
    },
    registerSelection(listener) {
      return view.onCommit((commit) => {
        if (commit.selectionChanged) listener();
      });
    },
    registerLayout: onCommit,
    registerBlur(listener) {
      const root = view.root;
      const blur = () => listener();
      root.addEventListener('blur', blur);
      return () => root.removeEventListener('blur', blur);
    },
    elementFor(key) {
      return view.isMounted
        ? (view.getElementByKey(key) ?? undefined)
        : undefined;
    },
    clipboardData() {
      if (!tableSelection()) return null;
      const data = view.clipboard.formats(0);
      return {
        'text/html': data.html,
        'text/plain': data.plain,
        'application/x-lexical-editor': data.lexical,
      };
    },
    clearCells() {
      if (!editable()) return;
      // The same path as backspacing a table selection, which also collapses it.
      dispatchApplicationCommand(
        view,
        'group-b.key',
        {},
        new KeyboardEvent('keydown', { key: 'Backspace' })
      );
    },
    clearSelection() {
      if (!view.isMounted) return;
      view.port.selectionFromView({ kind: 'none' });
    },
    merge: () => edit('selection-merge'),
    split: () => edit('selection-split'),
    paste(dataTransfer) {
      if (!editable()) return Promise.resolve();
      const cached = view.selection().selection;
      const selection = cached.kind === 'table' ? cached : readSelection(view);
      if (selection.kind !== 'table' && selection.kind !== 'range')
        return Promise.resolve();
      const pasteThenCollapse = async () => {
        try {
          // Source drops the selection in the same update whatever the insert
          // did; an admitted paste (even one inserting nothing) returns true.
          // false means the document or selection changed during the import,
          // and that newer selection is kept.
          const admitted = await view.clipboard.paste(dataTransfer, selection);
          if (admitted && view.isMounted)
            view.port.selectionFromView({ kind: 'none' });
        } catch (error) {
          view.options.onError(error);
        }
      };
      const pasted = pasteThenCollapse();
      fireAndForget(pasted, 'native-table-selection-paste');
      return pasted;
    },
  };
}
